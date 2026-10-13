'use strict';

/**
 * Brief（创意简报）：一句话创意被解析后的结构化结果。
 * 它是编剧/分镜/美术三个下游 Agent 的唯一输入，因此创意本身可以独立生成、编辑、复用。
 */

const crypto = require('crypto');

function newBriefId() {
    return `brf_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
}

function clampText(value, limit, fallback = '') {
    const chars = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim());
    if (!chars.length) return fallback;
    return chars.length <= limit ? chars.join('') : `${chars.slice(0, limit - 1).join('')}…`;
}

function toKeywordList(value) {
    const list = Array.isArray(value)
        ? value
        : String(value ?? '').split(/[，,、\s|/]+/);
    return [...new Set(list
        .map(item => String(item ?? '').replace(/\s+/g, '').trim())
        .filter(item => item.length >= 2 && item.length <= 8))]
        .slice(0, 6);
}

/** 统一 Brief 形状，保证下游字段齐全 */
function normalizeBrief(input = {}, { video } = {}) {
    const raw = clampText(input.raw ?? input.idea ?? '', 200);
    const shots = Number.parseInt(input.shots, 10);
    const duration = Number.parseFloat(input.duration);
    return {
        id: input.id || newBriefId(),
        createdAt: input.createdAt || new Date().toISOString(),
        raw,
        title: clampText(input.title, 12, '无声之夜'),
        logline: clampText(input.logline, 60, raw),
        genre: clampText(input.genre, 10, '都市悬疑'),
        tone: clampText(input.tone, 20, '冷静克制'),
        hook: clampText(input.hook, 30, raw),
        audience: clampText(input.audience, 20, '短片泛用户'),
        keywords: toKeywordList(input.keywords),
        shots: Number.isFinite(shots) && shots > 0 ? shots : video?.shots || 5,
        duration: Number.isFinite(duration) && duration > 0 ? duration : video?.totalSeconds || 15,
        source: input.source || 'offline'
    };
}

/** 把 Brief 还原成一段可直接喂给 LLM 的创意描述 */
function toPromptText(brief) {
    return [
        `创意原文：${brief.raw}`,
        `题材：${brief.genre}`,
        `情绪基调：${brief.tone}`,
        `开场钩子：${brief.hook}`,
        brief.keywords.length ? `关键词：${brief.keywords.join('、')}` : '',
        `目标观众：${brief.audience}`
    ].filter(Boolean).join('\n');
}

module.exports = { createBrief: normalizeBrief, normalizeBrief, toPromptText, newBriefId };
