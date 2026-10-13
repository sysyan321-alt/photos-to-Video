'use strict';

/**
 * 图生视频 provider 探活脚本：用「无效请求」问出接口真正需要的参数结构。
 * 不发送有效图片，因此不会产生生成费用。
 * 用法：docker compose exec comicdrama node scripts/probe-i2v.js
 */

const { createConfig } = require('../src/config');

const config = createConfig();
const cfg = config.i2v;

async function probe(label, path, init) {
    const url = `${cfg.baseUrl}${path}`;
    try {
        const response = await fetch(url, init);
        const text = await response.text();
        console.log(`\n── ${label}`);
        console.log(`   HTTP ${response.status} · ${String(init?.method || 'GET')} ${path}`);
        console.log(`   ${text.replace(/\s+/g, ' ').slice(0, 400)}`);
    } catch (error) {
        console.log(`\n── ${label}\n   请求异常: ${error.message}`);
    }
}

async function main() {
    console.log(`provider=${cfg.provider} baseUrl=${cfg.baseUrl}`);
    console.log(`model=${cfg.model} imageField=${cfg.imageField || '-'} keyLength=${(cfg.apiKey || '').length}`);
    if (!cfg.enabled) {
        console.log('未配置鉴权，先填 Provider-aliyun-API-KEY');
        return;
    }

    const auth = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };

    // 1. 鉴权探活：查一个不存在的任务
    await probe('鉴权探活（GET 不存在的任务）', '/api/v1/tasks/0000000000000000', { headers: auth });

    // 2. 异步视频合成：故意留空 input，观察服务端返回的参数校验信息
    await probe('video-synthesis（空 input）', '/api/v1/services/aigc/video-generation/video-synthesis', {
        method: 'POST',
        headers: { ...auth, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: cfg.model, input: {}, parameters: {} })
    });

    // 3. 只给 prompt，不给图片
    await probe('video-synthesis（只给 prompt）', '/api/v1/services/aigc/video-generation/video-synthesis', {
        method: 'POST',
        headers: { ...auth, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: cfg.model, input: { prompt: 'test' }, parameters: {} })
    });

    // 4. 百炼通用多模态接口（部分第三方模型走这条）
    await probe('multimodal-generation（通用接口）', '/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
            model: cfg.model,
            input: { messages: [{ role: 'user', content: [{ text: 'test' }] }] },
            parameters: {}
        })
    });
}

main().catch(error => {
    console.error(`探活失败: ${error.message}`);
    process.exit(1);
});
