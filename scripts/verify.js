'use strict';

/**
 * 成片自检：不依赖人眼，用像素统计确认「中文确实烧录进视频」。
 * 原理：字幕带（画面底部）叠加白色描边文字后，该区域平均亮度会明显高于无字版本。
 * 用法：docker compose exec growalbum node scripts/verify.js [项目ID]
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createConfig } = require('../src/config');
const { createStorage } = require('../src/services/storage');
const { findCjkFont, wrapCaption } = require('../src/services/ffmpeg');

const config = createConfig();
const storage = createStorage(config);

function run(bin, args) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
            if (error) return reject(new Error(`${bin} 失败: ${stderr.slice(-300)}`));
            resolve({ stdout, stderr });
        });
    });
}

/** 取画面底部字幕带的平均亮度（YAVG） */
async function captionBandLuma(input, { height, at } = {}) {
    const crop = `crop=${config.video.width}:420:0:${height - 420},signalstats,metadata=print:file=-`;
    const args = ['-hide_banner', '-v', 'error'];
    if (at !== undefined) args.push('-ss', String(at));
    args.push('-i', input, '-vf', crop, '-frames:v', '1', '-f', 'null', '-');
    const { stdout } = await run('ffmpeg', args);
    const match = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(stdout);
    return match ? Number.parseFloat(match[1]) : null;
}

async function main() {
    const projects = storage.listProjects();
    const project = process.argv[2]
        ? storage.getProject(process.argv[2])
        : projects.find(item => item.status === 'completed');
    if (!project) throw new Error('没有已完成的项目，请先在容器内跑 scripts/demo.js');

    const dirs = storage.paths(project.id);
    const video = project.outputs.video;
    // 关键帧可能是模型出图、面板占位，或相册原图 —— 一律以项目记录为准
    const keyframe = project.assets?.keyframes?.[0]?.path || path.join(dirs.keyframes, `${project.shots[0].shot_id}.png`);

    const probe = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', video]);
    const info = JSON.parse(probe.stdout);
    const stream = (info.streams || []).find(item => item.codec_type === 'video') || {};
    const audio = (info.streams || []).find(item => item.codec_type === 'audio') || {};

    console.log(`项目 ${project.id} 「${project.name}」`);
    console.log(`  分辨率 : ${stream.width}x${stream.height}`);
    console.log(`  时长   : ${Number.parseFloat(info.format.duration).toFixed(3)}s`);
    console.log(`  帧率   : ${stream.r_frame_rate}   编码: ${stream.codec_name} / 音频: ${audio.codec_name || '无'}`);
    console.log(`  体积   : ${(Number.parseInt(info.format.size, 10) / 1024 / 1024).toFixed(2)}MB`);

    const font = findCjkFont();
    if (!font) {
        console.log('\n⚠️  未找到中文字体，成片不含字幕（这是设计内的降级行为）');
        return;
    }

    // 用与流水线完全相同的 drawtext 参数渲染一张「字在黑底上」的对照图
    const tempDir = path.join(dirs.temp, 'verify');
    fs.mkdirSync(tempDir, { recursive: true });
    const textFile = path.join(tempDir, 'probe.txt');
    fs.writeFileSync(textFile, wrapCaption(project.shots[0].caption), 'utf8');
    const probePng = path.join(tempDir, 'probe.png');
    const drawtext = `drawtext=fontfile=${font}:textfile=${textFile}:fontsize=54:fontcolor=white:borderw=4:bordercolor=black@0.9:line_spacing=16:x=(w-text_w)/2:y=h-360`;
    await run('ffmpeg', [
        '-hide_banner', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=black:s=${config.video.width}x${config.video.height}`,
        '-vf', drawtext, '-frames:v', '1', probePng
    ]);

    const blackBand = 0;
    const textBand = await captionBandLuma(probePng, { height: config.video.height });
    const keyframeBand = await captionBandLuma(keyframe, { height: config.video.height });
    const videoBand = await captionBandLuma(video, { height: config.video.height, at: 1 });

    console.log(`\n字幕带平均亮度（YAVG，0-255）`);
    console.log(`  纯黑对照      : ${blackBand}`);
    console.log(`  中文渲染对照  : ${textBand}   -> ${textBand > 5 ? '中文可正常渲染 ✅' : '文字未渲染 ❌'}`);
    console.log(`  关键帧无字幕  : ${keyframeBand.toFixed(2)}`);
    console.log(`  成片第 1 秒   : ${videoBand.toFixed(2)}   -> ${videoBand - keyframeBand > 2 ? '字幕已烧录进成片 ✅' : '字幕未进入成片 ❌'}`);
}

main().catch(error => {
    console.error(`自检失败: ${error.message}`);
    process.exit(1);
});
