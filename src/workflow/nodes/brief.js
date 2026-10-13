'use strict';

const { buildBrief } = require('../../agents/idea');

module.exports = {
    id: 'brief',
    label: '创意解析',
    stage: 'pre',
    requires: [],
    produces: ['brief'],
    providerKind: 'llm',
    defaultEnabled: true,
    async run(ctx) {
        const llm = ctx.providers.get('llm');
        const idea = ctx.project.brief?.raw || ctx.project.initialIdea || '';
        if (!idea) throw new Error('缺少创意原文');

        const brief = await buildBrief({ idea, title: '', video: ctx.video, llm });
        ctx.storage.saveBrief(brief);
        ctx.project.briefId = brief.id;
        ctx.project.brief = brief;

        const degraded = brief.source !== 'llm';
        return {
            detail: `${brief.title} · ${brief.genre}（${brief.source === 'llm' ? '模型' : '内置规则'}）`,
            degraded,
            warnings: degraded && llm.enabled ? ['文本模型调用失败，已回退内置规则'] : []
        };
    }
};
