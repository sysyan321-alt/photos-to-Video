'use strict';

const path = require('path');
const { createLogger } = require('../logger');

const log = createLogger('provider-config');

/**
 * 模型接入配置：运行时在界面上改，落盘 data/config/providers.json。
 * 优先级：这里保存的值 > env.yaml > 默认值；保存后热加载注册表，不用重启容器。
 */
function createProviderConfig({ storage }) {
    const file = path.join(storage.root, 'config', 'providers.json');
    const load = () => storage.readJson(file, {}) || {};

    /** 把保存的配置叠加到 config（在创建注册表之前调用） */
    function apply(config) {
        const saved = load();
        // 文本环节：选的是百炼时，把 models.llm 归一到百炼凭据 —— 配置平台改的就是这一块
        if (config.providers.llm === 'aliyun') {
            config.models.llm = {
                baseUrl: config.models.image?.baseUrl,
                apiKey: config.models.image?.apiKey,
                model: saved.llm?.model || process.env.DASHSCOPE_LLM_MODEL || 'qwen3.7-max',
                enabled: Boolean(config.models.image?.apiKey)
            };
        }
        for (const kind of ['llm', 'image', 'i2v', 'tts']) {
            const override = saved[kind];
            if (!override) continue;
            if (override.provider) config.providers[kind] = override.provider;
            if (kind === 'i2v') {
                Object.assign(config.i2v, {
                    baseUrl: override.baseUrl || config.i2v.baseUrl,
                    apiKey: override.apiKey || config.i2v.apiKey,
                    accessKey: override.accessKey || config.i2v.accessKey,
                    secretKey: override.secretKey || config.i2v.secretKey,
                    model: override.model || config.i2v.model,
                    size: override.size || config.i2v.size,
                    resolution: override.resolution || config.i2v.resolution
                });
                config.i2v.enabled = Boolean(config.i2v.apiKey || (config.i2v.accessKey && config.i2v.secretKey));
                continue;
            }
            const target = config.models[kind];
            Object.assign(target, {
                baseUrl: override.baseUrl || target.baseUrl,
                apiKey: override.apiKey || target.apiKey,
                model: override.model || target.model,
                ...(kind === 'image' ? { size: override.size || target.size } : {}),
                ...(kind === 'tts' ? { voice: override.voice || target.voice } : {})
            });
            target.enabled = Boolean(target.apiKey && target.model);
        }
        log.info(`已应用运行时模型配置：${Object.keys(saved).join(',') || '（无）'}`);
        return config;
    }

    function save(kind, patch) {
        const saved = load();
        saved[kind] = { ...(saved[kind] || {}), ...patch };
        storage.writeJson(file, saved);
        log.info(`已保存 ${kind} 的模型配置`);
        return saved[kind];
    }

    return { file, load, save, apply };
}

/** 回传给界面的掩码，不暴露完整 Key */
function maskKey(key) {
    const value = String(key || '');
    if (!value) return '';
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

module.exports = { createProviderConfig, maskKey };
