'use strict';

/**
 * 提示词库（PromptPreset）与「槽位组装」。
 * 一条预设 = 一个槽位里的一段可复用文本；最终提示词 = 各槽位按固定顺序拼接。
 */

const crypto = require('crypto');

const SLOT_ORDER = ['style', 'consistency', 'scene', 'camera', 'lighting', 'extra'];

const SLOT_LABELS = {
    style: '画风',
    consistency: '一致性',
    scene: '场景',
    camera: '运镜',
    lighting: '光效',
    extra: '补充',
    negative: '负面',
    audio: '音频情绪'
};

const GROUP_SLOTS = {
    style: 'style',
    consistency: 'consistency',
    camera: 'camera',
    lighting: 'lighting',
    negative: 'negative',
    audio: 'audio'
};

/** 内置预设：首次启动自动落库，可改文本、可停用，但不建议删除 */
const BUILTIN_PRESETS = [
    // 面向个人相册的中性风格（不再是漫画偏向）
    { id: 'style.cinematic', group: 'style', name: '写实电影感', text: '写实电影感，浅景深，自然光比，真实质感', weight: 10 },
    { id: 'style.film', group: 'style', name: '胶片质感', text: '胶片质感，柔和颗粒，低对比，温暖影调', weight: 20 },
    { id: 'style.daily', group: 'style', name: '清透日常', text: '清透明亮的日常感，柔和自然光，通透肤色，留白构图', weight: 30 },
    { id: 'style.vintage', group: 'style', name: '复古暖调', text: '复古暖调，褪色感，午后光线，怀旧氛围', weight: 40 },
    { id: 'style.night', group: 'style', name: '冷调夜色', text: '冷调夜色，霓虹反光，低饱和，电影级暗部细节', weight: 50 },
    { id: 'consistency.character', group: 'consistency', name: '角色外观锁定', text: '严格保持角色的发型、发色、五官与服装与参考图一致', weight: 10 },
    { id: 'consistency.outfit', group: 'consistency', name: '服装状态锁定', text: '服装款式与状态在全部镜头中保持连续，不随镜头更换', weight: 20 },
    { id: 'camera.push', group: 'camera', name: '缓慢推近', key: '缓慢推近', text: '镜头缓慢推近，主体逐渐填满画面', weight: 10 },
    { id: 'camera.pull', group: 'camera', name: '缓慢拉远', key: '缓慢拉远', text: '镜头缓慢拉远，交代环境与人物关系', weight: 20 },
    { id: 'camera.pan', group: 'camera', name: '横向平移', key: '横向平移', text: '镜头横向平移，前景遮挡制造纵深', weight: 30 },
    { id: 'camera.tilt', group: 'camera', name: '轻微上摇', key: '轻微上摇', text: '镜头轻微上摇，从细节摇向全景', weight: 40 },
    { id: 'camera.handheld', group: 'camera', name: '手持轻晃', key: '手持轻晃', text: '手持镜头轻微晃动，紧张感与临场感', weight: 50 },
    { id: 'light.rim', group: 'lighting', name: '侧逆光', text: '侧逆光勾边，主体轮廓清晰' },
    { id: 'light.neon', group: 'lighting', name: '霓虹雨夜', text: '霓虹灯反射，冷暖对比，雨夜湿地反光' },
    { id: 'light.cold', group: 'lighting', name: '冷色调夜景', text: '冷蓝调夜景，低饱和，压抑氛围' },
    { id: 'light.tyndall', group: 'lighting', name: '丁达尔光束', text: '丁达尔光束，尘埃颗粒，体积光' },
    { id: 'negative.default', group: 'negative', name: '通用负面词', text: '畸形手, 多指, 崩脸, 五官错位, 低清晰度, 水印, 文字, 变形, 多余肢体' },
    { id: 'negative.text', group: 'negative', name: '禁止画面文字', text: '画面中不出现任何文字、字幕、水印、logo' },
    { id: 'audio.tense', group: 'audio', name: '克制紧张', text: '压低嗓音，语速偏慢，克制' },
    { id: 'audio.urgent', group: 'audio', name: '急促', text: '语速偏快，气息不稳，急迫' },
    { id: 'audio.gentle', group: 'audio', name: '温柔', text: '轻声，语速偏慢，温柔' }
];

function newPresetId(group) {
    return `${group}.${crypto.randomBytes(3).toString('hex')}`;
}

function clampText(value, limit, fallback = '') {
    const chars = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim());
    if (!chars.length) return fallback;
    return chars.length <= limit ? chars.join('') : chars.slice(0, limit).join('');
}

function normalizePreset(input = {}) {
    const group = GROUP_SLOTS[input.group] ? input.group : (GROUP_SLOTS[input.slot] ? input.slot : 'style');
    return {
        id: String(input.id || newPresetId(group)),
        group,
        slot: group,
        name: clampText(input.name, 20, '未命名'),
        text: clampText(input.text, 400, ''),
        key: input.key ? clampText(input.key, 20) : (group === 'camera' ? clampText(input.name, 20) : null),
        weight: Number.isFinite(Number(input.weight)) ? Number(input.weight) : 100,
        tags: Array.isArray(input.tags) ? input.tags.slice(0, 6).map(item => String(item).slice(0, 12)) : [],
        enabled: input.enabled === undefined ? true : Boolean(input.enabled),
        builtin: Boolean(input.builtin),
        createdAt: input.createdAt || new Date().toISOString()
    };
}

/** 保证内置预设始终存在（用户改过的文本不覆盖） */
function withBuiltins(list) {
    const map = new Map((list || []).map(item => [item.id, normalizePreset(item)]));
    for (const builtin of BUILTIN_PRESETS) {
        if (!map.has(builtin.id)) {
            map.set(builtin.id, normalizePreset({ ...builtin, builtin: true }));
        } else {
            map.get(builtin.id).builtin = true;
        }
    }
    return [...map.values()];
}

function groupPresets(list) {
    const groups = {};
    for (const preset of list) {
        if (!groups[preset.group]) {
            groups[preset.group] = { slot: preset.group, label: SLOT_LABELS[preset.group] || preset.group, items: [] };
        }
        groups[preset.group].items.push(preset);
    }
    for (const group of Object.values(groups)) {
        group.items.sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name, 'zh'));
    }
    return Object.values(groups);
}

function pickEnabled(list, ids, group) {
    const wanted = new Set(ids || []);
    return list
        .filter(preset => preset.group === group && preset.enabled && wanted.has(preset.id))
        .sort((a, b) => a.weight - b.weight);
}

/**
 * 槽位组装：把「预设 + 分镜 + 角色 + 项目」拼成每个镜头的最终提示词。
 * 单镜头可以用 shot.prompt_slots 覆盖项目级选择。
 */
function buildPrompt({ shot, script = {}, brief = {}, presets = [], slots = {}, order = SLOT_ORDER }) {
    const effective = { ...slots, ...(shot.prompt_slots || {}) };
    const asList = value => (Array.isArray(value) ? value : value ? [value] : []);
    const texts = (group, ids) => pickEnabled(presets, ids, group).map(preset => preset.text);

    // 运镜：按分镜的运镜名自动匹配预设（可在镜头级用 camera: 'off' 关掉）
    const cameraPreset = effective.camera === 'off'
        ? null
        : presets.find(preset => preset.group === 'camera' && preset.enabled && preset.key === shot.camera);

    const cast = (script.characters || [])
        .filter(character => !shot.characters?.length || shot.characters.includes(character.id))
        .map(character => `${character.name}（${character.appearance}）`)
        .join('；');

    const slotText = {
        style: texts('style', asList(effective.style)),
        consistency: texts('consistency', asList(effective.consistency)),
        scene: [
            `题材：${brief.genre || script.genre || '短片'}`,
            `基调：${brief.tone || script.tone || '克制'}`,
            `镜头语言：${shot.shot_size}，${shot.camera}`,
            `画面：${shot.visual_desc}`
        ],
        camera: cameraPreset ? [cameraPreset.text] : [],
        lighting: texts('lighting', asList(effective.lighting)),
        extra: [
            ...texts('extra', asList(effective.extra)),
            shot.emotion ? `情绪：${shot.emotion}` : '',
            cast ? `角色：${cast}` : '',
            effective.extraText ? String(effective.extraText) : ''
        ].filter(Boolean)
    };

    const lines = [];
    for (const slot of order) {
        const value = slotText[slot];
        if (!value) continue;
        if (Array.isArray(value)) lines.push(...value.filter(Boolean));
        else lines.push(value);
    }
    lines.push('9:16 竖屏，单张画面，无文字');

    const negative = texts('negative', asList(effective.negative)).join(', ');
    const presetIds = [
        ...asList(effective.style),
        ...asList(effective.consistency),
        ...asList(effective.lighting),
        ...asList(effective.negative),
        ...(cameraPreset ? [cameraPreset.id] : [])
    ];

    return {
        resolved_prompt: lines.join('\n'),
        negative_prompt: negative,
        preset_ids: [...new Set(presetIds)],
        // assembled_slots 是本次组装的快照（用于展示/复现）；
        // shot.prompt_slots 只存「用户显式覆盖」，两者不能混用，否则项目级改槽位会对老镜头失效
        assembled_slots: {
            style: asList(effective.style),
            consistency: asList(effective.consistency),
            lighting: asList(effective.lighting),
            negative: asList(effective.negative),
            camera: cameraPreset ? cameraPreset.id : 'auto',
            extraText: effective.extraText || ''
        }
    };
}

module.exports = {
    SLOT_ORDER,
    SLOT_LABELS,
    BUILTIN_PRESETS,
    newPresetId,
    normalizePreset,
    withBuiltins,
    groupPresets,
    buildPrompt
};
