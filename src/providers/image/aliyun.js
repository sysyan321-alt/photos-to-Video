'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../logger');
const { withRetry } = require('../../services/retry');

const log = createLogger('aliyun-image');

/**
 * 阿里云百炼（DashScope）文生图 provider。
 * 异步图像调用在该网关不可用，因此走**同步**多模态接口，直接返回图片 URL。
 * 例：qwen-image-3.0 约 0.02 元/张，一集 5 张关键帧成本可忽略。
 */
module.exports = {
    id: 'aliyun',
    kind: 'image',
    label: '百炼 Qwen-Image',
    create(config) {
        const cfg = config.models.image;

        async function generateImage({ prompt, outPath, size, timeoutMs = 180000 }) {
            if (!cfg.enabled) throw new Error('百炼图像模型未配置');
            const name = path.basename(outPath);

            // 同步出图：并发铺量时容易被 429 限流，每次尝试独立计时 + 退避重试
            const imageUrl = await withRetry(async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const response = await fetch(`${cfg.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: cfg.model,
                            input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
                            parameters: { size: size || cfg.size || '720*1280', n: 1, watermark: false }
                        }),
                        signal: controller.signal
                    });
                    const text = await response.text();
                    let data;
                    try {
                        data = JSON.parse(text);
                    } catch (error) {
                        throw new Error(`返回不是 JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
                    }
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
                    }
                    const contents = data?.output?.choices?.[0]?.message?.content || [];
                    const url = contents.find(item => item.image)?.image;
                    if (!url) throw new Error(`响应里没有图片地址: ${JSON.stringify(data).slice(0, 200)}`);
                    return url;
                } finally {
                    clearTimeout(timer);
                }
            }, { label: `出图 ${name}` });

            const buffer = await withRetry(async () => {
                const download = await fetch(imageUrl);
                if (!download.ok) throw new Error(`下载图片失败: HTTP ${download.status}`);
                return Buffer.from(await download.arrayBuffer());
            }, { label: `下载 ${name}` });

            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, buffer);
            log.info(`关键帧生成成功: ${name} (${(buffer.length / 1024).toFixed(0)}KB, ${cfg.model})`);
            return { path: outPath, bytes: buffer.length, source: 'aliyun' };
        }

        return {
            id: 'aliyun',
            kind: 'image',
            label: '百炼 Qwen-Image',
            enabled: cfg.enabled,
            model: cfg.model,
            capabilities: {
                referenceImage: false,
                aspectRatios: [cfg.aspectRatio || '9:16'],
                size: cfg.size,
                sync: true,
                maxBatch: 1
            },
            canRun: () => (cfg.enabled
                ? { ok: true }
                : { ok: false, reason: '未配置 Provider-aliyun-API-KEY 或 Provider-aliyun-IMAGE-MODEL' }),
            estimateCost: () => ({ unit: 'image', credits: 0.02 }),
            generateImage,
            run: options => generateImage(options)
        };
    }
};
