'use strict';

const { createImageService } = require('../../services/image');

/** Gemini / NanoBanana 兼容图像 provider（文生图 + 参考图） */
module.exports = {
    id: 'gemini',
    kind: 'image',
    label: 'Gemini / NanoBanana 图像',
    create(config) {
        const service = createImageService(config);
        const { enabled, model, aspectRatio } = config.models.image;
        return {
            id: 'gemini',
            kind: 'image',
            label: 'Gemini / NanoBanana 图像',
            enabled,
            model: model || null,
            capabilities: {
                // 参考图能力是角色/画风一致性的基础
                referenceImage: true,
                aspectRatios: [aspectRatio],
                maxBatch: 1
            },
            canRun: () => (enabled
                ? { ok: true }
                : { ok: false, reason: '未配置 Gemini-MODEL（图像模型）' }),
            estimateCost: () => ({ unit: 'image', credits: 1 }),
            run: options => service.generateImage(options),
            generateImage: options => service.generateImage(options)
        };
    }
};
