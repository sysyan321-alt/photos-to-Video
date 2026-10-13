'use strict';

const { createTtsService } = require('../../services/tts');

/** IndexTTS-2（Gitee AI / 模力方舟）配音 provider，支持情绪提示 */
module.exports = {
    id: 'indextts',
    kind: 'tts',
    label: 'IndexTTS-2 配音',
    create(config) {
        const service = createTtsService(config);
        const { enabled, model } = config.models.tts;
        return {
            id: 'indextts',
            kind: 'tts',
            label: 'IndexTTS-2 配音',
            enabled,
            model,
            capabilities: { emotion: true, voiceClone: true, perShotAlign: true },
            canRun: () => (enabled
                ? { ok: true }
                : { ok: false, reason: '未配置 TTS-API-KEY / TTS-Prompt-Audio-URL / TTS-Prompt-Text' }),
            estimateCost: ({ text }) => ({ unit: 'char', credits: String(text || '').length }),
            run: options => service.synthesize(options),
            synthesize: options => service.synthesize(options)
        };
    }
};
