'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const log = createLogger('tts');

/** IndexTTS-2（Gitee AI / 模力方舟）配音，支持 emo_text 情绪提示 */
function createTtsService(config) {
    const { endpoint, apiKey, model, promptAudioUrl, promptText, enabled } = config.models.tts;

    async function synthesize({ text, emotion, outPath, timeoutMs = 120000 }) {
        if (!enabled) throw new Error('TTS 未配置');
        const body = {
            input: text,
            model,
            prompt_audio_url: promptAudioUrl,
            prompt_text: promptText,
            voice: 'alloy',
            use_emo_text: Boolean(emotion)
        };
        if (emotion) body.emo_text = emotion;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            if (!response.ok) {
                const detail = await response.text();
                throw new Error(`HTTP ${response.status}: ${detail.slice(0, 300)}`);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            if (!buffer.length) throw new Error('TTS 返回空音频');
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, buffer);
            log.info(`配音生成成功: ${path.basename(outPath)} (${buffer.length} bytes)`);
            return { path: outPath, bytes: buffer.length, source: 'model' };
        } finally {
            clearTimeout(timer);
        }
    }

    return { enabled, model, synthesize };
}

module.exports = { createTtsService };
