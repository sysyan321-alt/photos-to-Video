'use strict';

const { createLogger } = require('../logger');

const log = createLogger('providers');

// 注册表：新增一家厂商 = 这里加一行；节点代码不用动
const CATALOG = {
    llm: {
        gemini: require('./llm/gemini'),
        aliyun: require('./llm/aliyun'),
        openai: require('./llm/openaiCompatible')
    },
    image: {
        gemini: require('./image/gemini'),
        aliyun: require('./image/aliyun')
    },
    i2v: {
        kling: require('./i2v/kling'),
        aliyun: require('./i2v/aliyun')
    },
    tts: {
        indextts: require('./tts/indextts'),
        aliyun: require('./tts/aliyun')
    }
};

const KIND_LABELS = { llm: '文本', image: '图像', i2v: '图生视频', tts: '配音' };

function createRegistry(config) {
    const selection = config.providers || {};
    const instances = {};
    const descriptions = {};

    for (const [kind, providers] of Object.entries(CATALOG)) {
        const available = Object.keys(providers);
        // 允许环境变量覆盖选择（COMIC_PROVIDER_LLM=aliyun 等），避免动配置文件
        const wanted = process.env[`COMIC_PROVIDER_${kind.toUpperCase()}`] || selection[kind];
        const chosen = providers[wanted] ? wanted : available[0];
        instances[kind] = providers[chosen].create(config);
        descriptions[kind] = {
            kind,
            kindLabel: KIND_LABELS[kind],
            id: instances[kind].id,
            label: instances[kind].label,
            model: instances[kind].model,
            enabled: instances[kind].enabled,
            capabilities: instances[kind].capabilities || {},
            available
        };
        log.debug(`provider ${kind} = ${chosen}（enabled=${instances[kind].enabled}）`);
    }

    return {
        get: kind => instances[kind],
        /** 热加载：把新注册表的适配器搬进当前实例，路由里持有的引用不用换 */
        reload(fresh) {
            for (const kind of Object.keys(CATALOG)) {
                if (!instances[kind]) continue;
                instances[kind] = fresh.get(kind);
                descriptions[kind] = fresh.describe()[kind];
            }
        },
        has: kind => Boolean(instances[kind]),
        describe: () => descriptions,
        catalog: () => Object.fromEntries(
            Object.entries(CATALOG).map(([kind, providers]) => [kind, Object.keys(providers)])
        ),
        canRun: kind => (instances[kind]?.canRun ? instances[kind].canRun() : { ok: false, reason: `未知 provider 类型 ${kind}` })
    };
}

module.exports = { createRegistry, CATALOG };
