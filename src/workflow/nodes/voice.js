'use strict';

const path = require('path');
const ffmpeg = require('../../services/ffmpeg');

module.exports = {
    id: 'voice',
    label: '配音',
    stage: 'render',
    requires: ['shots'],
    produces: ['audio'],
    providerKind: 'tts',
    defaultEnabled: true,
    async run(ctx) {
        const tts = ctx.providers.get('tts');
        const cache = require('../../services/cache').createCache(ctx.storage);
        const bedPath = path.join(ctx.dirs.audio, 'mix.wav');
        let fallbackReason = null;
        const hasDialogue = (ctx.project.shots || []).some(shot => String(shot.dialogue || '').trim());

        if (tts.enabled && hasDialogue) {
            try {
                const segments = [];
                for (const shot of ctx.project.shots) {
                    const rawPath = path.join(ctx.dirs.audio, `${shot.shot_id}.raw`);
                    // 配音也走缓存：同一句台词 + 同一音色再跑不重复付费
                    await cache.withCache({
                        kind: 'tts',
                        ext: 'wav',
                        outPath: rawPath,
                        parts: { provider: tts.id, model: tts.model, text: shot.dialogue, emotion: shot.emotion }
                    }, () => tts.synthesize({ text: shot.dialogue, emotion: shot.emotion, outPath: rawPath }));
                    const fitted = path.join(ctx.dirs.audio, `${shot.shot_id}.wav`);
                    // 台词比镜头长时不再硬截断：先探测时长，超了就加速（上限 1.6x），再补静音对齐
                    let tempo = 1;
                    try {
                        const probe = await ffmpeg.ffprobe(rawPath);
                        const ratio = probe.duration / ctx.video.shotSeconds;
                        if (ratio > 1.05) tempo = Math.min(ratio, 1.6);
                        if (ratio > 1.6) {
                            ctx.project.assets.audioTooLong = (ctx.project.assets.audioTooLong || 0) + 1;
                            ctx.log(`镜头 ${shot.shot_id} 台词偏长（${probe.duration.toFixed(1)}s / 镜头 ${ctx.video.shotSeconds}s），已加速到 1.6x 上限，建议改短台词`);
                        }
                    } catch (error) {
                        // 探测失败按原时长处理
                    }
                    await new Promise((resolve, reject) => {
                        require('child_process').execFile('ffmpeg', [
                            '-hide_banner', '-loglevel', 'error', '-y',
                            '-i', rawPath,
                            '-filter:a', tempo > 1.01 ? `atempo=${tempo.toFixed(2)},apad` : 'apad',
                            '-t', String(ctx.video.shotSeconds),
                            '-ar', '44100', '-ac', '2', fitted
                        ], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()));
                    });
                    segments.push(fitted);
                }
                await ffmpeg.concatAudio(segments, bedPath, path.join(ctx.dirs.temp, 'concat_audio.txt'));
                // 叠一层背景音乐，并用 sidechaincompress 让 BGM 在有人声时自动压低（ducking）
                const bgmPath = path.join(ctx.dirs.audio, 'bed.wav');
                // BGM 来源优先级：你自己的音乐库（data/bgm/<情绪>/ 或 data/bgm/）→ 本地合成音床
                const fsMod = require('fs');
                const bgmDir = path.join(ctx.storage.root, 'bgm');
                const moods = [...new Set((ctx.project.shots || []).map(shot => shot.emotion).filter(Boolean))];
                const exts = ['.mp3', '.wav', '.m4a', '.aac', '.flac'];
                const candidates = [];
                for (const mood of moods) {
                    const dir = path.join(bgmDir, mood);
                    if (fsMod.existsSync(dir)) {
                        for (const file of fsMod.readdirSync(dir)) {
                            if (exts.includes(path.extname(file).toLowerCase())) candidates.push(path.join(dir, file));
                        }
                    }
                }
                if (fsMod.existsSync(bgmDir)) {
                    for (const file of fsMod.readdirSync(bgmDir)) {
                        const full = path.join(bgmDir, file);
                        if (fsMod.statSync(full).isFile() && exts.includes(path.extname(file).toLowerCase())) candidates.push(full);
                    }
                }
                let bgmSource = 'synthetic';
                if (candidates.length) {
                    const picked = candidates[Math.floor(Math.random() * candidates.length)];
                    // 循环铺满时长并淡入淡出，避免突然断
                    await new Promise((resolve, reject) => {
                        require('child_process').execFile('ffmpeg', [
                            '-hide_banner', '-loglevel', 'error', '-y',
                            '-stream_loop', '-1', '-i', picked,
                            '-t', String(ctx.video.totalSeconds),
                            '-af', `afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, ctx.video.totalSeconds - 1.2).toFixed(2)}:d=1.2`,
                            '-ar', '44100', '-ac', '2', bgmPath
                        ], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()));
                    });
                    bgmSource = path.basename(picked);
                    ctx.log(`BGM 使用本地音乐：${bgmSource}`);
                } else {
                    await ffmpeg.renderAmbientBed(bgmPath, ctx.video.totalSeconds);
                    ctx.log('BGM 使用合成音床（把音乐放进 data/bgm/ 或 data/bgm/<情绪>/ 会自动优先使用）');
                }
                const mixedPath = path.join(ctx.dirs.audio, 'mixed.wav');
                await new Promise((resolve, reject) => {
                    require('child_process').execFile('ffmpeg', [
                        '-hide_banner', '-loglevel', 'error', '-y',
                        '-i', bedPath, '-i', bgmPath,
                        '-filter_complex',
                        '[1:a]volume=0.30[bg];[bg][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[ducked];[0:a][ducked]amix=inputs=2:duration=first[a]',
                        '-map', '[a]', '-ar', '44100', '-ac', '2', mixedPath
                    ], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()));
                });
                ctx.project.assets.audio = mixedPath;
                ctx.log('配音 + BGM 混音完成（人声处 BGM 自动压低）');
                return {
                    detail: `配音 ${segments.length} 段 + BGM(${bgmSource === 'synthetic' ? '合成音床' : bgmSource})，带 ducking`
                        + (ctx.project.assets.audioTooLong ? `；${ctx.project.assets.audioTooLong} 条台词偏长已加速` : ''),
                    cost: { unit: 'char', credits: ctx.project.shots.reduce((sum, shot) => sum + String(shot.dialogue || '').length, 0) }
                };
            } catch (error) {
                fallbackReason = error.message;
                ctx.log(`TTS 失败，改用环境音床：${error.message}`);
            }
        } else {
            fallbackReason = hasDialogue ? '未配置 TTS' : '没有台词';
        }

        await ffmpeg.renderAmbientBed(bedPath, ctx.video.totalSeconds);
        ctx.project.assets.audio = bedPath;
        return {
            detail: `环境音床（${fallbackReason}）`,
            degraded: true,
            warnings: [fallbackReason]
        };
    }
};
