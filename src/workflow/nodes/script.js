'use strict';

const { buildScript } = require('../../agents/script');

module.exports = {
    id: 'script',
    label: '剧本',
    stage: 'pre',
    requires: ['brief'],
    produces: ['script'],
    providerKind: 'llm',
    defaultEnabled: true,
    async run(ctx) {
        const llm = ctx.providers.get('llm');
        const brief = ctx.project.brief;
        if (!brief) throw new Error('缺少 Brief（请先运行创意解析节点）');

        const script = await buildScript({ brief, shotCount: ctx.video.shots, llm });
        ctx.project.script = script;
        ctx.project.characters = script.characters;
        ctx.project.name = script.title || ctx.project.name;
        ctx.storage.writeJson(ctx.dirs.scriptFile, script);

        return {
            detail: `${script.beats.length} 个节拍 / ${script.characters.length} 个角色（${script.source === 'llm' ? '模型' : '模板'}）`,
            degraded: script.source !== 'llm'
        };
    }
};
