'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../logger');

const log = createLogger('aliyun-tts');

/**
 * 阿里云百炼 TTS provider（qwen3-tts-flash，约 0.8 元/万字符）。
 * 走同步多媒体接口，返回音频 URL，下载后落盘交给合成节点。
 */
module.exports = {
    id: 'aliyun',
    kind: 'tts',
    label: '百炼 Qwen3-TTS',
    create(config) {
        const cfg = config.models.tts;
        // 角色音色映射：角色卡没有指定时用默认音色
        const voiceOf = character => character?.voice?.voiceId || cfg.voice;

        async function synthesize({ text, emotion, voice, outPath, timeoutMs = 120000 }) {
            if (!cfg.enabled) throw new Error('百炼 TTS 未配置');
            const content = String(text || '').trim();
            if (!content) throw new Error('配音文本为空');

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(`${cfg.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: cfg.model,
                        input: { text: content, voice: voice || cfg.voice },
                        parameters: { language_type: 'Chinese' }
                    }),
                    signal: controller.signal
                });
                const body = await response.text();
                let data;
                try {
                    data = JSON.parse(body);
                } catch (error) {
                    throw new Error(`返回不是 JSON (HTTP ${response.status}): ${body.slice(0, 200)}`);
                }
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || body.slice(0, 200)}`);

                const url = data?.output?.audio?.url;
                if (!url) throw new Error(`响应里没有音频地址: ${JSON.stringify(data).slice(0, 200)}`);
                const audio = Buffer.from(await (await fetch(url)).arrayBuffer());
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, audio);
                log.info(`配音成功: ${path.basename(outPath)} (${(audio.length / 1024).toFixed(0)}KB, voice=${voice || cfg.voice}${emotion ? `, 情绪=${emotion}` : ''})`);
                return { path: outPath, bytes: audio.length, source: 'aliyun' };
            } finally {
                clearTimeout(timer);
            }
        }

        return {
            id: 'aliyun',
            kind: 'tts',
            label: '百炼 Qwen3-TTS',
            enabled: cfg.enabled,
            model: cfg.model,
            capabilities: { emotion: false, voiceClone: false, perShotAlign: true, voices: 'installed' },
            voiceOf,
            canRun: () => (cfg.enabled ? { ok: true } : { ok: false, reason: '未配置 Provider-aliyun-API-KEY 或 Provider-aliyun-TTS-MODEL' }),
            estimateCost: ({ text }) => ({ unit: 'char', credits: String(text || '').length * 0.00008 }),
            synthesize,
            run: options => synthesize(options)
        };
    }
};
