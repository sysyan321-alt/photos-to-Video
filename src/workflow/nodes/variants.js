'use strict';

const fs = require('fs');
const path = require('path');

/**
 * ① 创意阶段：用最便宜的图像模型（qwen-image-3.0 ≈ 0.02 元/张）铺多个风格方向的
 * 关键帧变体，先在图上看构图与角色感觉 —— 比直接出视频草稿便宜约 50 倍。
 */
module.exports = {
    id: 'variants',
    label: '关键帧变体',
    stage: 'pre',
    requires: ['prompt@shot'],
    // 变体本身就是关键帧（选定后会被提升为正式关键帧），因此声明产出 keyframe@shot，
    // 这样下游 i2v / 合成节点的契约校验才成立
    produces: ['variants', 'keyframe@shot'],
    providerKind: 'image',
    defaultEnabled: false,
    params: {
        directions: [
            { id: 'A', name: '国漫赛璐璐', style: 'style.guoman' },
            { id: 'B', name: '水墨写意', style: 'style.ink' },
            { id: 'C', name: '写实电影感', style: 'style.cinematic' }
        ],
        // 0 = 覆盖全部镜头。只铺部分镜头时，其余镜头没有关键帧，下游合成会直接失败。
        shots: 0
    },
    canRun(ctx) {
        const image = ctx.providers.get('image');
        return image?.enabled ? { ok: true } : { ok: false, reason: '图像 provider 未配置' };
    },
    async run(ctx) {
        const image = ctx.providers.get('image');
        const stored = ctx.storage.loadPresets() || [];
        const directions = ctx.params.directions || [];
        const shotLimit = Number(ctx.params.shots) > 0 ? Number(ctx.params.shots) : ctx.project.shots.length;
        const shots = ctx.project.shots.slice(0, shotLimit);
        const variants = [];
        let count = 0;

        for (const direction of directions) {
            const variantId = `var_${direction.id}`;
            const dir = path.join(ctx.dirs.keyframes, 'variants', variantId);
            fs.mkdirSync(dir, { recursive: true });
            const styleText = (stored.find(item => item.id === direction.style) || {}).text || '';
            const files = [];

            // 并发出图（默认 3 路）：同步接口下并发不额外收费，但能把 6 张的等待压到 1/3
            const queue = shots.map((shot, index) => ({ shot, index }));
            const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
                while (queue.length) {
                    const { shot } = queue.shift();
                    const outPath = path.join(dir, `${shot.shot_id}.png`);
                    // 去掉原提示词里的画风词，替换成本方向的风格
                    const base = (shot.resolved_prompt || shot.keyframe_prompt || '')
                        .split('\n').filter(line => line && !/国漫|水墨|韩漫|写实|美式/.test(line)).join('\n');
                    await image.generateImage({ prompt: `${styleText}\n${base}`, outPath, size: ctx.config.models.image?.size });
                    files.push({ shot_id: shot.shot_id, path: outPath });
                    count += 1;
                }
            });
            await Promise.all(workers);
            // 并发完成顺序是乱的，按镜头顺序排回去——下游合成是按索引取关键帧的
            const order = new Map(shots.map((shot, index) => [shot.shot_id, index]));
            files.sort((a, b) => (order.get(a.shot_id) ?? 0) - (order.get(b.shot_id) ?? 0));
            variants.push({ id: variantId, name: direction.name, style: direction.style, shots: files });
            ctx.log(`方向 ${direction.name}：${files.length} 张完成`);
        }

        ctx.project.variants = variants;
        ctx.storage.saveProject(ctx.project);
        return {
            detail: `${variants.length} 个方向 × ${shots.length} 个镜头 = ${count} 张（约 ${(count * 0.02).toFixed(2)} 元）`,
            cost: { unit: 'image', credits: count * 0.02 }
        };
    }
};
