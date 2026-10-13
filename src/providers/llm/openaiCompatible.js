'use strict';

const { createLogger } = require('../../logger');
const { parseJsonLoose } = require('../../services/llm');

const log = createLogger('openai-llm');

/**
 * OpenAI 兼容文本 provider —— 一个适配器覆盖十几家：
 *   通义千问 / DeepSeek / Kimi / 智谱 GLM / 豆包 / 百川 / MiniMax / OpenAI
 *   / 以及本地 vLLM、Ollama、LM Studio（都能开 /v1/chat/completions）
 * 配置里只改 BaseURL + 模型名即可。
 */
module.exports = {
    id: 'openai',
    kind: 'llm',
    label: 'OpenAI 兼容（多厂商通用）',
    create(config) {
        const cfg = config.models.llm || {};
        const enabled = Boolean(cfg.baseUrl && cfg.apiKey && cfg.model);

        function endpoint() {
            const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
            return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
        }

        async function generateText({ system, prompt, temperature = 0.85, json = false, timeoutMs = 120000 }) {
            if (!enabled) throw new Error('OpenAI 兼容 provider 未配置（需要 BaseURL + API Key + 模型名）');
            const messages = [];
            if (system) messages.push({ role: 'system', content: system });
            messages.push({ role: 'user', content: prompt + (json ? '\n\n只输出 JSON，不要解释、不要 markdown 代码块。' : '') });

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(endpoint(), {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: cfg.model,
                        messages,
                        temperature,
                        ...(json ? { response_format: { type: 'json_object' } } : {})
                    }),
                    signal: controller.signal
                });
                const raw = await response.text();
                let data;
                try {
                    data = JSON.parse(raw);
                } catch (error) {
                    throw new Error(`返回不是 JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`);
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${data?.error?.message || data?.message || raw.slice(0, 200)}`);
                }
                const answer = String(data?.choices?.[0]?.message?.content || '').trim();
                if (!answer) throw new Error(`模型没有返回文本: ${JSON.stringify(data).slice(0, 200)}`);
                return answer;
            } finally {
                clearTimeout(timer);
            }
        }

        async function generateJson(options) {
            const answer = await generateText({ ...options, json: true });
            try {
                return parseJsonLoose(answer);
            } catch (error) {
                log.warn(`JSON 解析失败: ${answer.slice(0, 120)}`);
                throw error;
            }
        }

        return {
            id: 'openai',
            kind: 'llm',
            label: 'OpenAI 兼容（多厂商通用）',
            enabled,
            model: cfg.model,
            capabilities: { json: true, multiVendor: true },
            canRun: () => (enabled
                ? { ok: true }
                : { ok: false, reason: '需要配置 BaseURL / API Key / 模型名' }),
            estimateCost: () => ({ unit: 'call', credits: 1 }),
            /** 只读自检：拉一次 /models 确认 Key 与地址可用（不消耗生成额度） */
            async test() {
                if (!cfg.baseUrl) return { ok: false, message: '未配置 BaseURL' };
                const base = String(cfg.baseUrl).replace(/\/+$/, '');
                const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
                try {
                    const response = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
                    return response.ok
                        ? { ok: true, message: `连通正常（HTTP ${response.status}）` }
                        : { ok: false, message: `HTTP ${response.status}，请检查 BaseURL / Key` };
                } catch (error) {
                    return { ok: false, message: `无法连接: ${error.message}` };
                }
            },
            generateText,
            generateJson,
            run: options => generateJson(options)
        };
    }
};
