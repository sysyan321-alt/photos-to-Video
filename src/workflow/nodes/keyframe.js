'use strict';

const fs = require('fs');
const path = require('path');
const ffmpeg = require('../../services/ffmpeg');

module.exports = {
    id: 'keyframe',
    label: '关键帧',
    stage: 'render',
    requires: ['prompt@shot'],
    produces: ['keyframe@shot'],
    providerKind: 'image',
    defaultEnabled: true,
    async run(ctx) {
        const image = ctx.providers.get('image');
        const cache = require('../../services/cache').createCache(ctx.storage);
        const font = ffmpeg.findCjkFont();
        const results = new Array(ctx.project.shots.length);
        let modelCount = 0;
        let panelCount = 0;
        let cacheHits = 0;

        async function renderOne(index) {
            const shot = ctx.project.shots[index];
            const outPath = path.join(ctx.dirs.keyframes, `${shot.shot_id}.png`);
            // 提示词落盘：便于人工复核、复用与调参
            fs.writeFileSync(
                path.join(ctx.dirs.keyframes, `${shot.shot_id}.prompt.txt`),
                `${shot.keyframe_prompt}\n\n--- negative ---\n${shot.negative_prompt}\n`,
                'utf8'
            );

            let source = 'panel';
            // 画面来源是相册照片：直接缩放裁切成 9:16 关键帧，不调图像模型（0 元）
            if (shot.image_source === 'album' && shot.source_path && fs.existsSync(shot.source_path)) {
                await new Promise((resolve, reject) => {
                    require('child_process').execFile('ffmpeg', [
                        '-hide_banner', '-loglevel', 'error', '-y',
                        '-i', shot.source_path,
                        '-vf', `scale=${ctx.video.width}:${ctx.video.height}:force_original_aspect_ratio=increase,crop=${ctx.video.width}:${ctx.video.height}`,
                        '-frames:v', '1', '-update', '1', outPath
                    ], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()));
                });
                source = 'album';
                ctx.project.assets.albumFrames = (ctx.project.assets.albumFrames || 0) + 1;
                ctx.log(`镜头 ${shot.shot_id} 使用相册照片（${shot.source_label || ''}）`);
            } else if (image.enabled && shot.image_source !== 'panel') {
                try {
                    const cached = await cache.withCache({
                        kind: 'image',
                        ext: 'png',
                        outPath,
                        parts: { provider: image.id, model: image.model, prompt: shot.keyframe_prompt, size: ctx.config.models.image?.size }
                    }, () => image.generateImage({ prompt: shot.keyframe_prompt, outPath }));
                    if (cached.cached) cacheHits += 1;
                    source = 'model';
                    modelCount += 1;
                } catch (error) {
                    ctx.log(`镜头 ${shot.shot_id} 出图失败，改用面板占位：${error.message}`);
                }
            }
            if (source !== 'model') {
                await ffmpeg.renderPanel({
                    outPath,
                    colors: shot.palette,
                    label: shot.panel_label,
                    font,
                    video: ctx.video,
                    tempDir: ctx.dirs.temp,
                    index: index + 1
                });
                panelCount += 1;
            }

            const thumb = await ffmpeg.renderThumbnail(outPath, path.join(ctx.dirs.keyframes, 'thumbs', `${shot.shot_id}.jpg`));
            results[index] = { shot_id: shot.shot_id, path: outPath, thumb, source };
        }

        // 并发 3 路：图像接口是同步的，并发不额外收费，但能把 5 张的等待压到 1/3
        const queue = ctx.project.shots.map((_, index) => index);
        await Promise.all(Array.from({ length: Math.min(Number(ctx.params.concurrency) || 3, queue.length) }, async () => {
            while (queue.length) {
                const index = queue.shift();
                try {
                    await renderOne(index);
                } catch (error) {
                    ctx.log(`镜头 ${ctx.project.shots[index].shot_id} 处理失败：${error.message}`);
                }
            }
        }));

        const slots = results.filter(Boolean);
        ctx.project.assets.keyframes = slots;
        ctx.storage.saveProject(ctx.project);
        if (slots.length !== ctx.project.shots.length) {
            throw new Error(`关键帧缺失：应有 ${ctx.project.shots.length} 张，实际 ${slots.length} 张`);
        }

        return {
            detail: `模型出图 ${modelCount}（缓存命中 ${cacheHits}）/ 面板占位 ${panelCount}`,
            degraded: panelCount > 0,
            cost: { unit: 'yuan', credits: Number((modelCount * 0.02).toFixed(4)) }
        };
    }
};
