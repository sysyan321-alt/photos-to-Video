'use strict';

const { createLogger } = require('../logger');

const log = createLogger('llm');

/** 解析模型返回的 JSON：容忍 ```json 包裹和前后废话 */
function parseJsonLoose(raw) {
    const cleaned = String(raw || '')
        .replace(/^\s*```(?:json)?/i, '')
        .replace(/```\s*$/, '')
        .trim();
    try {
        return JSON.parse(cleaned);
    } catch (error) {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw new Error('无法解析模型返回的 JSON');
    }
}

function createLlmService(config) {
    const { baseUrl, apiKey, model, enabled } = config.models.llm;

    async function generateText({ system, prompt, temperature = 0.85, json = false, timeoutMs = 90000 }) {
        if (!enabled) throw new Error('文本模型未配置');
        const url = `${baseUrl}/v1beta/models/${model}:generateContent`;
        const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature,
                ...(json ? { responseMimeType: 'application/json' } : {})
            }
        };
        if (system) body.systemInstruction = { parts: [{ text: system }] };

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
            const text = parts.map(part => part.text || '').join('').trim();
            if (!text) throw new Error('模型返回内容为空');
            return text;
        } finally {
            clearTimeout(timer);
        }
    }

    async function generateJson(options) {
        try {
            return parseJsonLoose(await generateText({ ...options, json: true }));
        } catch (error) {
            log.warn('JSON 生成失败', { message: error.message });
            throw error;
        }
    }

    return { enabled, model, generateText, generateJson };
}

module.exports = { createLlmService, parseJsonLoose };
