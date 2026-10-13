'use strict';

const { hashString } = require('../../agents/script');
const { buildPrompt, withBuiltins, groupPresets, SLOT_LABELS } = require('../../domain/preset');

// 面板占位图也保持统一视觉，避免每个镜头风格漂移。
// 配色偏亮：占位构图要能看清轮廓，不能像黑屏。
const PALETTES = [
    ['0x2f4a78', '0x9fc3e8'],
    ['0x3d3470', '0xb8a6e0'],
    ['0x7a3348', '0xe8b0a0'],
    ['0x1f5a5e', '0x9fd8d0'],
    ['0x5a4630', '0xe0cfa0']
];

/**
 * 提示词组装：提示词库预设 + 分镜 + 角色，按槽位拼成每个镜头的最终提示词。
 * 结果写到 shot.resolved_prompt，并记录 preset_ids 以便复现。
 */
module.exports = {
    id: 'prompt_assembly',
    label: '提示词组装',
    stage: 'pre',
    requires: ['shots'],
    produces: ['prompt@shot'],
    providerKind: null,
    defaultEnabled: true,
    params: {
        // 项目级槽位选择，镜头级可用 shot.prompt_slots 覆盖
        slots: {
            style: ['style.guoman'],
            consistency: ['consistency.character'],
            lighting: [],
            negative: ['negative.default']
        },
        order: ['style', 'consistency', 'scene', 'camera', 'lighting', 'extra']
    },
    async run(ctx) {
        if (!ctx.project.shots?.length) throw new Error('缺少分镜（请先运行分镜节点）');

        const stored = ctx.storage.loadPresets();
        const presets = withBuiltins(stored);
        if (!stored) ctx.storage.savePresets(presets);

        const script = ctx.project.script || {};
        const brief = ctx.project.brief || {};
        const slots = ctx.params.slots || {};
        const order = ctx.params.order || undefined;
        const seed = hashString(ctx.project.name || brief.title || 'comicdrama');
        const usedPresets = new Set();

        ctx.project.shots = ctx.project.shots.map((shot, index) => {
            const assembled = buildPrompt({ shot, script, brief, presets, slots, order });
            assembled.preset_ids.forEach(id => usedPresets.add(id));
            return {
                ...shot,
                // 下游统一消费 resolved_prompt；keyframe_prompt 保留兼容
                keyframe_prompt: assembled.resolved_prompt,
                resolved_prompt: assembled.resolved_prompt,
                negative_prompt: assembled.negative_prompt,
                preset_ids: assembled.preset_ids,
                assembled_slots: assembled.assembled_slots,
                // 注意：这里不写 shot.prompt_slots —— 那一位只保留用户的手动覆盖
                palette: shot.palette || PALETTES[(seed + index) % PALETTES.length],
                panel_label: shot.panel_label || `SHOT ${String(index + 1).padStart(2, '0')} · ${shot.shot_size}`
            };
        });

        const summary = Object.keys(slots)
            .filter(key => Array.isArray(slots[key]) && slots[key].length)
            .map(key => `${SLOT_LABELS[key] || key}×${slots[key].length}`)
            .join(' ');

        return {
            detail: `${ctx.project.shots.length} 条提示词 / 预设 ${usedPresets.size} 个 / 槽位组 ${groupPresets(presets).length}${summary ? ` (${summary})` : ''}`,
            meta: { presets: [...usedPresets] }
        };
    }
};
