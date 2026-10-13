'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../logger');

const log = createLogger('kling');

function base64url(input) {
    return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** 可灵开放平台鉴权：AccessKey + SecretKey 用 HS256 签 JWT（不引第三方依赖） */
function signJwt(accessKey, secretKey, ttlSeconds = 1800) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ iss: accessKey, exp: now + ttlSeconds, nbf: now - 5 }));
    const signature = crypto.createHmac('sha256', secretKey)
        .update(`${header}.${payload}`)
        .digest('base64')
        .replace(/=+$/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `${header}.${payload}.${signature}`;
}

/**
 * 可灵图生视频 provider。
 * 能力：首帧图生视频，5/10 秒，std/pro 两档，支持 9:16。
 */
module.exports = {
    id: 'kling',
    kind: 'i2v',
    label: '可灵 Kling 图生视频',
    create(config) {
        const cfg = config.i2v;
        const authMode = cfg.accessKey && cfg.secretKey ? 'jwt' : 'bearer';

        function headers() {
            const token = authMode === 'jwt' ? signJwt(cfg.accessKey, cfg.secretKey) : cfg.apiKey;
            return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        }

        const describeAuth = () => (authMode === 'jwt' ? 'AccessKey/SecretKey (JWT)' : 'API Key');

        async function request(method, urlPath, body, timeoutMs) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(`${cfg.baseUrl}${urlPath}`, {
                    method,
                    headers: headers(),
                    body: body ? JSON.stringify(body) : undefined,
                    signal: controller.signal
                });
                const text = await response.text();
                let data;
                try {
                    data = JSON.parse(text);
                } catch (error) {
                    data = { raw: text.slice(0, 300) };
                }
                return { status: response.status, ok: response.ok, data };
            } finally {
                clearTimeout(timer);
            }
        }

        async function createTask({ imageBase64, prompt, negativePrompt, durationSeconds, mode }) {
            const payload = {
                model_name: cfg.model,
                image: imageBase64,
                prompt: prompt || '',
                negative_prompt: negativePrompt || '',
                cfg_scale: 0.5,
                mode: mode || cfg.mode,
                duration: String(durationSeconds || cfg.maxSeconds)
            };
            const { ok, status, data } = await request('POST', '/v1/videos/image2video', payload, 60000);
            if (!ok || (data.code !== undefined && data.code !== 0)) {
                const code = data.code !== undefined ? `, code ${data.code}` : '';
                throw new Error(`创建任务失败 (HTTP ${status}${code}): ${data.message || JSON.stringify(data).slice(0, 200)}`);
            }
            const taskId = data?.data?.task_id;
            if (!taskId) throw new Error(`未返回 task_id: ${JSON.stringify(data).slice(0, 200)}`);
            return taskId;
        }

        async function waitTask(taskId, onProgress) {
            const deadline = Date.now() + cfg.timeoutMs;
            let lastStatus = '';
            while (Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, cfg.pollIntervalMs));
                const { ok, status, data } = await request('GET', `/v1/videos/image2video/${taskId}`, null, 30000);
                if (!ok || (data.code !== undefined && data.code !== 0)) {
                    throw new Error(`查询任务失败 (HTTP ${status}): ${data.message || JSON.stringify(data).slice(0, 200)}`);
                }
                const task = data.data || {};
                if (task.task_status !== lastStatus) {
                    lastStatus = task.task_status;
                    onProgress?.(`任务状态 ${task.task_status}`);
                }
                if (task.task_status === 'succeed') {
                    const url = task?.task_result?.videos?.[0]?.url;
                    if (!url) throw new Error('任务成功但没有视频地址');
                    return url;
                }
                if (task.task_status === 'failed') {
                    throw new Error(`任务失败: ${task.task_status_msg || '未知原因'}`);
                }
            }
            throw new Error(`任务超时（${Math.round(cfg.timeoutMs / 1000)}s）`);
        }

        async function download(url, outPath) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`下载视频失败: HTTP ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, buffer);
            return buffer.length;
        }

        return {
            id: 'kling',
            kind: 'i2v',
            label: '可灵 Kling 图生视频',
            enabled: cfg.enabled,
            model: cfg.model,
            authMode,
            capabilities: {
                firstFrame: true,
                lastFrame: false,
                maxSeconds: cfg.maxSeconds,
                resolutions: ['720p', '1080p'],
                aspectRatios: ['9:16'],
                modes: ['std', 'pro'],
                concurrent: 2
            },
            canRun: () => (cfg.enabled
                ? { ok: true }
                : { ok: false, reason: '未配置可灵鉴权（Provider-kling-API-KEY 或 ACCESS-KEY/SECRET-KEY）' }),
            estimateCost: ({ credits = 6 } = {}) => ({ unit: 'shot', credits }),

            /** 鉴权自检：查一个不存在的任务，用返回码判断 Key 是否有效（不消耗生成额度） */
            async test() {
                if (!cfg.enabled) return { ok: false, message: '未配置可灵鉴权' };
                const { status, data } = await request('GET', '/v1/videos/image2video/0000000000000000', null, 20000);
                const message = String(data.message || '');
                const authFailed = status === 401 || status === 403
                    || /auth|token|permission|unauthor/i.test(message)
                    || [1002, 1003, 1004].includes(data.code);
                if (authFailed) {
                    return { ok: false, message: `鉴权失败（${describeAuth()}）: ${message || `HTTP ${status}`}` };
                }
                return {
                    ok: true,
                    message: `鉴权通过（${describeAuth()}，model ${cfg.model}）: ${message || `HTTP ${status}`}`
                };
            },

            /** 首帧图 → 视频，返回落盘路径 */
            async run({ imagePath, prompt, negativePrompt, durationSeconds, outPath, mode, onProgress }) {
                if (!cfg.enabled) throw new Error('可灵 provider 未配置');
                if (!fs.existsSync(imagePath)) throw new Error(`首帧图片不存在: ${imagePath}`);

                const buffer = fs.readFileSync(imagePath);
                if (buffer.length > 10 * 1024 * 1024) throw new Error('首帧图片超过 10MB，可灵不接受');

                onProgress?.('提交图生视频任务');
                const taskId = await createTask({
                    imageBase64: buffer.toString('base64'),
                    prompt,
                    negativePrompt,
                    durationSeconds: durationSeconds || cfg.maxSeconds,
                    mode
                });
                log.info(`可灵任务已提交: ${taskId}`);

                const videoUrl = await waitTask(taskId, onProgress);
                const bytes = await download(videoUrl, outPath);
                log.info(`可灵成片已下载: ${path.basename(outPath)} (${bytes} bytes)`);
                return { path: outPath, bytes, taskId, videoUrl, source: 'kling' };
            }
        };
    }
};
