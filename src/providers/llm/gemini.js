'use strict';

const { createLlmService } = require('../../services/llm');

/**
 * Gemini 兼容文本 provider（本地反代 / 官方网关均可）。
 * 适配器把「能力元数据」和「实现」放在一起：节点只认 kind='llm'，换厂只换注册表一行。
 */
module.exports = {
    id: 'gemini',
    kind: 'llm',
    label: 'Gemini 兼容文本',
    create(config) {
        const service = createLlmService(config);
        const { enabled, model } = config.models.llm;
        return {
            id: 'gemini',
            kind: 'llm',
            label: 'Gemini 兼容文本',
            enabled,
            model,
            capabilities: { json: true, vision: false, streaming: false },
            canRun: () => (enabled
                ? { ok: true }
                : { ok: false, reason: '未配置 Gemini-API-KEY / Gemini-BASE-URL' }),
            estimateCost: () => ({ unit: 'call', credits: 1 }),
            run: options => service.generateJson(options),
            generateText: options => service.generateText(options),
            generateJson: options => service.generateJson(options)
        };
    }
};
