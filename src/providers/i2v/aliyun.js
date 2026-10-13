'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../logger');
const { withRetry } = require('../../services/retry');

const log = createLogger('aliyun-i2v');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * 阿里云百炼（DashScope）图生视频 provider。
 * 走百炼的异步任务协议：提交任务 → 轮询 /api/v1/tasks/{id} → 下载结果视频。
 * 不同视频模型的入参字段不同（img_url / reference_images 等），因此 imageField 可配置。
 */
module.exports = {
    id: 'aliyun',
    kind: 'i2v',
    label: '百炼 DashScope 视频模型',
    create(config) {
        const cfg = config.i2v;
        const createPath = process.env.DASHSCOPE_CREATE_PATH
            || '/api/v1/services/aigc/video-generation/video-synthesis';
        const taskPath = id => `/api/v1/tasks/${id}`;
        // 该接口不接受 oss:// 地址，但接受 base64 data URI（默认模式），
        // 因此本地关键帧无需图床即可直接提交。
        const mediaMode = process.env.DASHSCOPE_MEDIA_MODE || 'datauri'; // datauri | upload
        const uploadCache = new Map();

        function toDataUri(imagePath) {
            const buffer = fs.readFileSync(imagePath);
            const mime = MIME[path.extname(imagePath).toLowerCase()] || 'image/png';
            return `data:${mime};base64,${buffer.toString('base64')}`;
        }

        /**
         * 该接口要求 media[].url 是**服务端可访问的图片地址**：
         * 本地关键帧必须先走百炼官方临时上传接口换成 oss:// 地址。
         */
        async function uploadImage(imagePath) {
            if (uploadCache.has(imagePath)) return uploadCache.get(imagePath);

            const policyResponse = await fetch(
                `${cfg.baseUrl}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(cfg.model)}`,
                { headers: { Authorization: `Bearer ${cfg.apiKey}` } }
            );
            const policyPayload = await policyResponse.json();
            const policy = policyPayload.data || {};
            if (!policy.upload_host || !policy.policy) {
                throw new Error(`获取上传凭证失败: ${JSON.stringify(policyPayload).slice(0, 200)}`);
            }

            const fileName = path.basename(imagePath);
            // 官方要求 key = <upload_dir>/<filename>，少这个斜杠会导致服务端拿不到图
            const uploadDir = String(policy.upload_dir || '').replace(/\/+$/, '');
            const key = uploadDir ? `${uploadDir}/${fileName}` : fileName;
            const form = new FormData();
            form.append('OSSAccessKeyId', policy.oss_access_key_id);
            form.append('policy', policy.policy);
            form.append('Signature', policy.signature);
            form.append('key', key);
            if (policy.x_oss_object_acl) form.append('x-oss-object-acl', policy.x_oss_object_acl);
            if (policy.x_oss_forbid_overwrite) form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
            form.append('success_action_status', '200');
            form.append('file', new Blob([fs.readFileSync(imagePath)]), fileName);

            const uploadResponse = await fetch(policy.upload_host, { method: 'POST', body: form });
            if (!uploadResponse.ok) {
                throw new Error(`图片上传失败 (HTTP ${uploadResponse.status}): ${(await uploadResponse.text()).slice(0, 200)}`);
            }
            const url = `oss://${key}`;
            log.info(`关键帧已上传: ${fileName} → ${url}`);
            uploadCache.set(imagePath, url);
            return url;
        }

        async function buildMedia(imagePath, referenceImages) {
            const sources = referenceImages?.length ? referenceImages : [imagePath];
            const urls = [];
            for (const source of sources) {
                urls.push(mediaMode === 'datauri' ? toDataUri(source) : await uploadImage(source));
            }
            return urls.map(url => ({ type: 'image', url }));
        }

        async function request(method, urlPath, { body, asyncTask = false, timeoutMs = 60000 } = {}) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const headers = {
                    Authorization: `Bearer ${cfg.apiKey}`,
                    'Content-Type': 'application/json'
                };
                if (asyncTask) headers['X-DashScope-Async'] = 'enable';
                const response = await fetch(`${cfg.baseUrl}${urlPath}`, {
                    method,
                    headers,
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

        function failureMessage(data, status) {
            return data?.message || data?.output?.message || data?.code || `HTTP ${status}`;
        }

        return {
            id: 'aliyun',
            kind: 'i2v',
            label: '百炼 DashScope 视频模型',
            enabled: cfg.enabled,
            model: cfg.model,
            capabilities: {
                firstFrame: true,
                referenceImages: cfg.imageField === 'reference_images',
                maxSeconds: cfg.maxSeconds,
                resolutions: [cfg.resolution],
                aspectRatios: ['9:16'],
                concurrent: 2
            },
            canRun: () => (cfg.enabled
                ? { ok: true }
                : { ok: false, reason: '未配置 Provider-aliyun-API-KEY' }),
            estimateCost: ({ credits = 8 } = {}) => ({ unit: 'shot', credits }),

            /** 只读探活：查一个不存在的任务，用于确认鉴权与网络（不消耗额度） */
            async test() {
                if (!cfg.enabled) return { ok: false, message: '未配置百炼 API Key' };
                const { status, data } = await request('GET', taskPath('0000000000000000'), { timeoutMs: 20000 });
                const message = failureMessage(data, status);
                const authFailed = status === 401 || /invalid.?api.?key|unauthorized|authentication/i.test(String(message));
                if (authFailed) return { ok: false, message: `鉴权失败: ${message}` };
                return { ok: true, message: `鉴权通过（model ${cfg.model}）: ${String(message).slice(0, 120)}` };
            },

            /** 首帧/参考图 → 视频 */
            async run({ imagePath, prompt, negativePrompt, durationSeconds, outPath, referenceImages, onProgress }) {
                if (!cfg.enabled) throw new Error('百炼 provider 未配置');
                if (!imagePath || !fs.existsSync(imagePath)) throw new Error(`首帧图片不存在: ${imagePath}`);

                onProgress?.('提交百炼视频任务');
                const body = {
                    model: cfg.model,
                    input: {
                        prompt: prompt || '',
                        media: await buildMedia(imagePath, referenceImages)
                    },
                    parameters: {
                        resolution: cfg.resolution,
                        duration: Number(durationSeconds || cfg.maxSeconds),
                        size: cfg.size,
                        watermark: false
                    }
                };
                log.info(`提交参数: model=${body.model} input=[${Object.keys(body.input).join(',')}] media=${body.input.media.length} 张 size=${body.parameters.size} duration=${body.parameters.duration}`);

                // 提交任务也会被限流：429/5xx 退避重试，其它错误交给调用方判断
                const created = await withRetry(async () => {
                    const res = await request('POST', createPath, { body, asyncTask: true });
                    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
                    return res;
                }, { retries: 3, label: `提交视频任务 ${path.basename(outPath)}` });
                const taskId = created.data?.output?.task_id;
                if (!taskId) {
                    throw new Error(`创建任务失败 (HTTP ${created.status}): ${failureMessage(created.data, created.status)}`);
                }
                log.info(`百炼任务已提交: ${taskId}`);

                const deadline = Date.now() + cfg.timeoutMs;
                let lastStatus = '';
                while (Date.now() < deadline) {
                    await new Promise(resolve => setTimeout(resolve, cfg.pollIntervalMs));
                    const { status, data } = await request('GET', taskPath(taskId), { timeoutMs: 30000 });
                    const output = data?.output || {};
                    if (output.task_status && output.task_status !== lastStatus) {
                        lastStatus = output.task_status;
                        onProgress?.(`任务状态 ${lastStatus}`);
                    }
                    if (output.task_status === 'SUCCEEDED') {
                        const url = output.video_url
                            || output?.results?.video_url
                            || output?.video?.url
                            || output?.results?.[0]?.url;
                        if (!url) throw new Error(`任务成功但没找到视频地址: ${JSON.stringify(output).slice(0, 200)}`);
                        const response = await fetch(url);
                        if (!response.ok) throw new Error(`下载视频失败: HTTP ${response.status}`);
                        const buffer = Buffer.from(await response.arrayBuffer());
                        fs.mkdirSync(path.dirname(outPath), { recursive: true });
                        fs.writeFileSync(outPath, buffer);
                        log.info(`百炼成片已下载: ${path.basename(outPath)} (${buffer.length} bytes)`);
                        return { path: outPath, bytes: buffer.length, taskId, videoUrl: url, source: 'aliyun' };
                    }
                    if (output.task_status === 'FAILED' || output.task_status === 'CANCELED') {
                        throw new Error(`任务失败: ${output.message || output.code || output.task_status}`);
                    }
                }
                throw new Error(`任务超时（${Math.round(cfg.timeoutMs / 1000)}s）`);
            }
        };
    }
};
