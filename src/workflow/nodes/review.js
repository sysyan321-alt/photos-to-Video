'use strict';

/**
 * 审核 + 运营：M4 会接文本/视觉模型做风险检查，
 * 当前先输出规则版发布包（标题候选 / 简介 / 标签 / 封面文案）。
 */
module.exports = {
    id: 'review',
    label: '审核与运营',
    stage: 'render',
    requires: ['video'],
    produces: ['publish_pack'],
    providerKind: 'llm',
    defaultEnabled: false,
    async run(ctx) {
        const brief = ctx.project.brief || {};
        const script = ctx.project.script || {};
        const keywords = brief.keywords || [];
        const base = brief.title || ctx.project.name || '短片';
        const pack = {
            titles: [
                base,
                `${base}｜${(brief.hook || '反转来了').slice(0, 12)}`,
                `前3秒就上头：${base}`
            ],
            intro: (script.logline || brief.logline || '').slice(0, 50),
            tags: [...new Set([brief.genre || script.genre || '短片', '短片', '动态漫', 'AI短片', '短剧', ...keywords])].slice(0, 10),
            cover: base.slice(0, 6),
            riskLevel: 'unchecked',
            issues: []
        };
        ctx.project.publishPack = pack;
        return { detail: `${pack.titles.length} 个标题 / ${pack.tags.length} 个标签（规则版，未接入审核模型）`, degraded: true };
    }
};
