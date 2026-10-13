'use strict';

const { buildStoryboard } = require('../../agents/storyboard');

module.exports = {
    id: 'storyboard',
    label: '分镜',
    stage: 'pre',
    requires: ['script'],
    produces: ['shots'],
    providerKind: 'llm',
    defaultEnabled: true,
    async run(ctx) {
        const llm = ctx.providers.get('llm');
        const script = ctx.project.script;
        if (!script) throw new Error('缺少剧本（请先运行剧本节点）');

        const storyboard = await buildStoryboard({ script, video: ctx.video, llm });
        ctx.project.shots = storyboard.shots;
        ctx.project.storyboard = {
            ...(ctx.project.storyboard || {}),
            episode: storyboard.episode,
            total_duration: storyboard.total_duration,
            source: storyboard.source
        };

        return {
            detail: `${storyboard.shots.length} 个镜头（${storyboard.source === 'llm' ? '模型' : '模板'}）`,
            degraded: storyboard.source !== 'llm'
        };
    }
};
