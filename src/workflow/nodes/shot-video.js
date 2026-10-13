'use strict';

const path = require('path');
const ffmpeg = require('../../services/ffmpeg');

/**
 * 镜头视频（图生视频，i2v）：把关键帧交给视频模型生成动态镜头。
 * - 失败或缺失的镜头自动回落轻动态（由合成节点兜底），不会拖垮整条链
 * - params.limit 可以限制本次生成数量，用它压成本（例如先只生成前 2 个镜头看效果）
 */
module.exports = {
    id: 'shot_video',
    label: '镜头视频（i2v）',
    stage: 'render',
    requires: ['keyframe@shot'],
    produces: ['clip@shot'],
    providerKind: 'i2v',
    defaultEnabled: false,
    params: { mode: 'std', duration: 5, limit: null },

    canRun(ctx) {
        const provider = ctx.providers.get('i2v');
        if (!provider?.enabled) return { ok: false, reason: '图生视频 provider 未配置（缺可灵 Key）' };
        return { ok: true };
    },

    async run(ctx) {
        const provider = ctx.providers.get('i2v');
        // 缓存实例：按「模型 + 提示词 + 时长 + 关键帧内容」哈希复用已生成的镜头视频
        const cache = require('../../services/cache').createCache(ctx.storage);
        const font = ffmpeg.findCjkFont();
        const shotVideos = { ...(ctx.project.assets.shotVideos || {}) };
        const limit = Number(ctx.params.limit) > 0 ? Number(ctx.params.limit) : null;
        let succeeded = 0;
        let failed = 0;
        let attempted = 0;
        let skipped = 0;

        for (let index = 0; index < ctx.project.shots.length; index += 1) {
            // 按「尝试次数」限流：失败也算一次，避免全失败时把每个镜头都试一遍
            if (limit && attempted >= limit) {
                ctx.log(`已达到 i2v 生成上限 ${limit}，其余镜头走轻动态`);
                break;
            }
            const shot = ctx.project.shots[index];
            const keyframe = (ctx.project.assets.keyframes || [])[index];
            if (!keyframe?.path) {
                ctx.log(`镜头 ${shot.shot_id} 没有关键帧，跳过 i2v`);
                continue;
            }

            const rawPath = path.join(ctx.dirs.clips, `${shot.shot_id}.i2v.mp4`);
            const fittedPath = path.join(ctx.dirs.clips, `${shot.shot_id}.mp4`);

            // 可动性预判：先判断这张图值不值得花 i2v 的钱（主体是否清晰、有无运动空间）。
            // 不达标直接走轻动态 —— 这是"省每次调用费"的自动化机制。
            if (ctx.params.motionCheck !== false) {
                try {
                    const vision = require('../../services/vision').createVisionService({
                        baseUrl: ctx.config.models.image?.baseUrl,
                        apiKey: ctx.config.models.image?.apiKey,
                        model: process.env.DASHSCOPE_VISION_MODEL || 'qwen3-vl-plus'
                    });
                    const verdict = await vision.scoreImage({
                        imagePath: keyframe.path,
                        purpose: '进行图生视频（主体清晰、有运动空间、动作可延续）'
                    });
                    const threshold = Number(ctx.params.motionThreshold) > 0 ? Number(ctx.params.motionThreshold) : 6;
                    if (verdict.score < threshold) {
                        skipped += 1;
                        ctx.log(`镜头 ${shot.shot_id} 可动性 ${verdict.score} 分（低于 ${threshold}），跳过 i2v 走轻动态：${verdict.reason}`);
                        continue;
                    }
                    ctx.log(`镜头 ${shot.shot_id} 可动性 ${verdict.score} 分，进入 i2v`);
                } catch (error) {
                    ctx.log(`可动性预判失败（按可用处理）：${error.message}`);
                }
            }

            attempted += 1;
            try {
                // 这个接口的 parameters 只认 duration/resolution/size，负面词拼进 prompt 更稳
                const motionPrompt = [shot.motion_prompt || shot.visual_desc || shot.caption || '',
                    shot.negative_prompt ? `避免出现：${shot.negative_prompt}` : ''].filter(Boolean).join('；');
                const cached = await cache.withCache({
                    kind: 'i2v',
                    ext: 'mp4',
                    outPath: rawPath,
                    parts: {
                        provider: provider.id, model: provider.model, prompt: motionPrompt,
                        duration: ctx.params.duration, mode: ctx.params.mode, size: ctx.config.i2v.size,
                        imageHash: require('crypto').createHash('sha1').update(require('fs').readFileSync(keyframe.path)).digest('hex').slice(0, 16)
                    }
                }, () => provider.run({
                    imagePath: keyframe.path,
                    // 相册里绑定的角色参考图（最多 3 张）一起喂给模型，提升角色一致性
                    referenceImages: (ctx.project.characterRefs || []).map(ref => ref.path),
                    prompt: motionPrompt,
                    durationSeconds: Number(ctx.params.duration) || provider.capabilities.maxSeconds,
                    mode: ctx.params.mode,
                    outPath: rawPath,
                    onProgress: message => ctx.log(`[${shot.shot_id}] ${message}`)
                }));
                if (cached.cached) ctx.log(`镜头 ${shot.shot_id} 命中缓存，未产生费用`);
                await ffmpeg.fitClip(rawPath, fittedPath, {
                    video: ctx.video,
                    caption: shot.caption,
                    font,
                    tempDir: ctx.dirs.temp,
                    index: index + 1
                });
                shotVideos[shot.shot_id] = fittedPath;
                succeeded += 1;
                ctx.project.assets.shotVideos = shotVideos;
                ctx.storage.saveProject(ctx.project);
                ctx.log(`镜头 ${shot.shot_id} 图生视频完成（${succeeded}）`);
            } catch (error) {
                failed += 1;
                ctx.log(`镜头 ${shot.shot_id} 图生视频失败，回落轻动态：${error.message}`);
            }
        }

        if (!succeeded) {
            // 全部失败不阻断渲染：按设计回落轻动态，把原因留给任务面板和日志
            ctx.log(`图生视频全部失败（${failed} 个镜头），已全部回落轻动态`);
            return {
                detail: `i2v 全部失败（${failed} 个），已回落轻动态`,
                degraded: true,
                warnings: ['图生视频不可用：请检查可灵鉴权、额度与模型名']
            };
        }

        const detail = `i2v 成功 ${succeeded}${skipped ? ` / 预判跳过 ${skipped}` : ''}${failed ? ` / 失败 ${failed}（已回落轻动态）` : ''}，model ${provider.model}`;
        return {
            detail,
            degraded: failed > 0,
            // 按实际时长计价（fast 模型 0.3125 元/秒）
            cost: { unit: 'yuan', credits: Number((succeeded * (Number(ctx.params.duration) || 3) * 0.3125).toFixed(4)) }
        };
    }
};
