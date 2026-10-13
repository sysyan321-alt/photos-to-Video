'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createLogger } = require('../logger');

const log = createLogger('ffmpeg');

// 镜头运动 -> zoompan 表达式（on = 当前输出帧序号）
const CAMERA_MOTION = {
    '缓慢推近': { z: 'min(1+0.0016*on,1.14)', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
    '缓慢拉远': { z: 'max(1.14-0.0016*on,1.0)', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
    '横向平移': { z: '1.12', x: '(iw-iw/zoom)*min(on/74,1)', y: 'ih/2-(ih/zoom/2)' },
    '轻微上摇': { z: '1.12', x: 'iw/2-(iw/zoom/2)', y: '(ih-ih/zoom)*(1-min(on/74,1))' },
    '手持轻晃': { z: 'min(1.04+0.0008*on,1.10)', x: 'iw/2-(iw/zoom/2)+6*sin(on/6)', y: 'ih/2-(ih/zoom/2)+4*cos(on/5)' }
};

const FONT_DIRS = [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    '/System/Library/Fonts',
    '/Library/Fonts',
    path.join(os.homedir(), 'Library/Fonts')
];
const CJK_HINTS = /CJK|WenQuanYi|wqy|PingFang|Hiragino|Hei|Song|SourceHan|NotoSansSC|noto.*sc/i;
const FONT_EXT = /\.(ttf|otf|ttc|otc)$/i;

let fontCache;
let fontScanned = false;

function collectFonts(dir, depth, bucket) {
    if (depth > 4) return;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectFonts(full, depth + 1, bucket);
        } else if (FONT_EXT.test(entry.name)) {
            bucket.push(full);
        }
    }
}

/** 找一个能渲染中文的字体文件，找不到就返回 null（渲染时自动跳过文字层） */
function findCjkFont() {
    if (fontScanned) return fontCache;
    fontScanned = true;
    const fonts = [];
    for (const dir of FONT_DIRS) collectFonts(dir, 0, fonts);
    fontCache = fonts.find(file => CJK_HINTS.test(path.basename(file)))
        || fonts.find(file => /\.(ttf|otf|ttc|otc)$/i.test(file) && /noto/i.test(path.basename(file)))
        || null;
    if (fontCache) {
        log.info(`字幕字体: ${fontCache}`);
    } else {
        log.warn('未找到可用字体，成片将不烧录字幕（面板标签同样跳过）');
    }
    return fontCache;
}

function run(bin, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 1024 * 1024 * 128, ...options }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = stderr;
                error.stdout = stdout;
                error.command = `${bin} ${args.join(' ')}`;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

function ffmpeg(args, options) {
    return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], options);
}

/** 中文按字符数折行；drawtext 不会自动换行，所以先切成多行写进 textfile */
function wrapCaption(text, maxCharsPerLine = 12, maxLines = 2) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const chars = Array.from(clean);
    const lines = [];
    for (let i = 0; i < chars.length && lines.length < maxLines; i += maxCharsPerLine) {
        lines.push(chars.slice(i, i + maxCharsPerLine).join(''));
    }
    if (chars.length > maxCharsPerLine * maxLines && lines.length) {
        const last = lines.length - 1;
        lines[last] = `${lines[last].slice(0, -1)}…`;
    }
    return lines.join('\n');
}

function writeTempText(tempDir, name, content) {
    fs.mkdirSync(tempDir, { recursive: true });
    const file = path.join(tempDir, name);
    fs.writeFileSync(file, content, 'utf8');
    return file;
}

/** 关键帧：漫画分镜面板（渐变底 + 网点 + 边框 + 底部字幕带 + 镜号标签） */
async function renderPanel({ outPath, colors, label, font, video, tempDir, index }) {
    const { width, height } = video;
    const bandTop = Math.round(height * 0.78);
    // 占位面板用于"未配置模型"的成片，整体偏亮、暗角与字幕带收敛，
    // 避免在屏幕上看起来像黑屏
    const base = [
        `drawgrid=w=${Math.round(width / 8)}:h=${Math.round(height / 10)}:t=1:c=white@0.05`,
        'vignette=PI/12',
        `drawbox=x=48:y=48:w=${width - 96}:h=${height - 96}:t=3:c=white@0.55`,
        `drawbox=x=0:y=${bandTop}:w=${width}:h=${height - bandTop}:t=fill:c=black@0.30`
    ];

    if (font && label) {
        const labelFile = writeTempText(tempDir, `label_${String(index).padStart(2, '0')}.txt`, label);
        base.push(`drawtext=fontfile=${font}:textfile=${labelFile}:fontsize=40:fontcolor=white@0.8:x=96:y=96`);
    }

    const gradient = `gradients=s=${width}x${height}:c0=${colors[0]}:c1=${colors[1]}:nb_colors=2:type=linear:d=1:speed=0`;
    try {
        await ffmpeg(['-f', 'lavfi', '-i', [gradient, ...base].join(','), '-frames:v', '1', '-update', '1', outPath]);
    } catch (error) {
        // 部分精简版 ffmpeg 未编译 gradients，退化为纯色底
        log.warn(`gradients 滤镜不可用，改用纯色底: ${error.message}`);
        const flat = `color=c=${colors[0]}:s=${width}x${height}`;
        await ffmpeg(['-f', 'lavfi', '-i', [flat, ...base].join(','), '-frames:v', '1', '-update', '1', outPath]);
    }
    return outPath;
}

/** 单个镜头：关键帧 -> 3 秒轻动态片段（Ken Burns + 字幕烧录） */
async function renderClip({ imagePath, outPath, camera, caption, font, video, tempDir, index }) {
    const { width, height, fps, shotSeconds } = video;
    const frames = Math.round(shotSeconds * fps);
    const motion = CAMERA_MOTION[camera] || CAMERA_MOTION['缓慢推近'];

    const chain = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=${frames}:s=${width}x${height}:fps=${fps}`
    ];

    if (font && caption) {
        const captionFile = writeTempText(tempDir, `caption_${String(index).padStart(2, '0')}.txt`, wrapCaption(caption));
        chain.push(
            `drawtext=fontfile=${font}:textfile=${captionFile}:fontsize=54:fontcolor=white:borderw=4:bordercolor=black@0.9:line_spacing=16:x=(w-text_w)/2:y=h-360`
        );
    }

    await ffmpeg([
        '-loop', '1',
        '-i', imagePath,
        '-filter_complex', `[0:v]${chain.join(',')}[v]`,
        '-map', '[v]',
        '-frames:v', String(frames),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        outPath
    ]);
    return outPath;
}

async function concatClips(clipPaths, outPath, listFile) {
    const content = clipPaths.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, `${content}\n`, 'utf8');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath]);
    return outPath;
}

/** 离线兜底音轨：两个低频正弦叠加成环境音床 */
async function renderAmbientBed(outPath, seconds) {
    const fadeOutStart = Math.max(0, seconds - 1.4).toFixed(2);
    await ffmpeg([
        '-f', 'lavfi', '-i', `sine=frequency=196:duration=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=294:duration=${seconds}`,
        '-filter_complex',
        `[0:a][1:a]amix=inputs=2:duration=shortest,volume=0.12,afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart}:d=1.4[a]`,
        '-map', '[a]',
        '-ar', '44100',
        '-ac', '2',
        outPath
    ]);
    return outPath;
}

/** 把一条配音拉伸/裁剪到镜头时长，保证音画对齐 */
async function fitAudioSegment(inPath, outPath, seconds) {
    await ffmpeg([
        '-i', inPath,
        '-af', 'apad',
        '-t', String(seconds),
        '-ar', '44100',
        '-ac', '2',
        outPath
    ]);
    return outPath;
}

async function concatAudio(segmentPaths, outPath, listFile) {
    const content = segmentPaths.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, `${content}\n`, 'utf8');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath]);
    return outPath;
}

async function muxFinal({ videoPath, audioPath, outPath }) {
    const args = ['-i', videoPath];
    if (audioPath) args.push('-i', audioPath);
    args.push('-map', '0:v');
    if (audioPath) args.push('-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-shortest');
    args.push('-c:v', 'copy', '-movflags', '+faststart', outPath);
    await ffmpeg(args);
    return outPath;
}

async function extractPoster(videoPath, outPath, atSeconds = 5) {
    // 短视频（例如相册只有 1 张图 → 3 秒）不能按固定 5 秒取帧，否则会越界导致编码器报错
    let at = Math.max(0, Number(atSeconds) || 0);
    try {
        const info = await ffprobe(videoPath);
        if (info.duration) at = Math.min(at, Math.max(0, info.duration - 0.1));
    } catch (error) {
        // 探测失败就按原值取帧
    }
    await ffmpeg(['-ss', at.toFixed(2), '-i', videoPath, '-frames:v', '1', '-update', '1', outPath]);
    return outPath;
}

/** 素材网格用的缩略图：关键帧原图 1080x1920 太重，列表里只加载小图 */
async function renderThumbnail(inPath, outPath, width = 360) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await ffmpeg(['-i', inPath, '-vf', `scale=${width}:-2`, '-q:v', '4', outPath]);
    return outPath;
}

/**
 * 把外部生成的视频（图生视频等）规整成成片需要的规格：
 * 统一到目标分辨率/帧率、裁到镜头时长（不足时循环补足）、并按需烧录字幕。
 * 这样它才能和轻动态片段无缝 concat。
 */
async function fitClip(inPath, outPath, { video, caption, font, tempDir, index }) {
    const { width, height, fps, shotSeconds } = video;
    const chain = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        `fps=${fps}`
    ];
    if (font && caption && tempDir) {
        const captionFile = writeTempText(tempDir, `caption_i2v_${String(index || 0).padStart(2, '0')}.txt`, wrapCaption(caption));
        chain.push(
            `drawtext=fontfile=${font}:textfile=${captionFile}:fontsize=54:fontcolor=white:borderw=4:bordercolor=black@0.9:line_spacing=16:x=(w-text_w)/2:y=h-360`
        );
    }
    await ffmpeg([
        '-stream_loop', '-1',
        '-i', inPath,
        '-vf', chain.join(','),
        '-t', String(shotSeconds),
        '-an',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        outPath
    ]);
    return outPath;
}

async function ffprobe(filePath) {
    const { stdout } = await run('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
    ]);
    const data = JSON.parse(stdout);
    const videoStream = (data.streams || []).find(stream => stream.codec_type === 'video') || {};
    const audioStream = (data.streams || []).find(stream => stream.codec_type === 'audio') || {};
    return {
        duration: Number(Number.parseFloat(data.format?.duration || '0').toFixed(3)),
        sizeBytes: Number.parseInt(data.format?.size || '0', 10),
        width: videoStream.width || null,
        height: videoStream.height || null,
        fps: videoStream.r_frame_rate || null,
        videoCodec: videoStream.codec_name || null,
        audioCodec: audioStream.codec_name || null,
        hasAudio: Boolean(audioStream.codec_name)
    };
}

async function probeVersion() {
    const { stdout } = await run('ffmpeg', ['-version']);
    return stdout.split('\n')[0].trim();
}

module.exports = {
    CAMERA_MOTION,
    findCjkFont,
    wrapCaption,
    renderPanel,
    renderClip,
    concatClips,
    renderAmbientBed,
    fitAudioSegment,
    concatAudio,
    muxFinal,
    extractPoster,
    renderThumbnail,
    fitClip,
    ffprobe,
    probeVersion
};
