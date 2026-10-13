'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const log = createLogger('image');

/** Gemini / NanoBanana 兼容的文生图接口（与仓库既有生图逻辑保持一致） */
function createImageService(config) {
    const { baseUrl, apiKey, model, aspectRatio, enabled } = config.models.image;

    async function generateImage({ prompt, outPath, timeoutMs = 180000 }) {
        if (!enabled) throw new Error('图像模型未配置');
        const url = `${baseUrl}/v1beta/models/${model}:generateContent`;
        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { imageConfig: { aspectRatio } }
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            if (!response.ok) {
                const detail = await response.text();
                throw new Error(`HTTP ${response.status}: ${detail.slice(0, 300)}`);
            }
            const data = await response.json();
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const inline = parts.find(part => part.inlineData?.data);
            if (!inline) throw new Error('响应中没有图像数据');

            const buffer = Buffer.from(inline.inlineData.data, 'base64');
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, buffer);
            log.info(`关键帧生成成功: ${path.basename(outPath)} (${buffer.length} bytes)`);
            return { path: outPath, bytes: buffer.length, source: 'model' };
        } finally {
            clearTimeout(timer);
        }
    }

    return { enabled, model, aspectRatio, generateImage };
}

module.exports = { createImageService };
