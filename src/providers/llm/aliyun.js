'use strict';

const { createLogger } = require('../../logger');
const { parseJsonLoose } = require('../../services/llm');

const log = createLogger('aliyun-llm');

/**
 * 百炼（DashScope）文本模型 provider：创意解析、剧本、分镜都用它。
 * 复用同一把 Key 与网关；走已验证可用的 generation 接口（文本 content）。
 */
module.exports = {
    id: 'aliyun',
    kind: 'llm',
    label: '百炼 Qwen 文本',
    create(config) {
        // 优先读自己的 config 切片（配置平台写的就是这里），再退回图像那块的凭据 / 环境变量
        const baseUrl = config.models.llm?.baseUrl || config.models.image?.baseUrl;
        const apiKey = config.models.llm?.apiKey || config.models.image?.apiKey;
        const model = config.models.llm?.model || process.env.DASHSCOPE_LLM_MODEL || 'qwen3.7-max';
        const enabled = Boolean(baseUrl && apiKey);

        async function generateText({ system, prompt, temperature = 0.85, json = false, timeoutMs = 120000 }) {
            if (!enabled) throw new Error('百炼文本模型未配置');
            const text = [
                system ? `【系统指令】\n${system}` : '',
                prompt,
                json ? '只输出 JSON，不要任何解释、不要 markdown 代码块。' : ''
            ].filter(Boolean).join('\n\n');

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                // 不同模型挂在不同服务路径上，按顺序试；404/参数错就换下一条
                const paths = [
                    '/api/v1/services/aigc/text-generation/generation',
                    '/api/v1/services/aigc/multimodal-generation/generation'
                ];
                let response = null;
                let raw = '';
                for (const path of paths) {
                    response = await fetch(`${baseUrl}${path}`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model,
                            input: { messages: [{ role: 'user', content: [{ text }] }] },
                            parameters: { temperature }
                        }),
                        signal: controller.signal
                    });
                    raw = await response.text();
                    if (response.ok) break;
                    log.warn(`${path} 返回 ${response.status}，尝试下一个接口`);
                }
                let data;
                try {
                    data = JSON.parse(raw);
                } catch (error) {
                    throw new Error(`返回不是 JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`);
                }
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || raw.slice(0, 200)}`);
                // 注意：文本接口返回 content 是字符串，多模态接口才是 [{text}] 数组
                const content = data?.output?.choices?.[0]?.message?.content;
                const answer = (Array.isArray(content)
                    ? content.map(item => item.text || '').join('')
                    : String(content || '')).trim();
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
            id: 'aliyun',
            kind: 'llm',
            label: '百炼 Qwen 文本',
            enabled,
            model,
            capabilities: { json: true, vision: true, streaming: false },
            canRun: () => (enabled ? { ok: true } : { ok: false, reason: '未配置百炼 API Key' }),
            estimateCost: () => ({ unit: 'call', credits: 1 }),
            generateText,
            generateJson,
            run: options => generateJson(options)
        };
    }
};
