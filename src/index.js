'use strict';

const http = require('http');
const path = require('path');
const { createConfig, describeConfig } = require('./config');
const { createLogger } = require('./logger');
const { createStorage } = require('./services/storage');
const { createRegistry } = require('./providers/registry');
const ffmpegService = require('./services/ffmpeg');
const { createGalleryService } = require('./services/gallery');
const { createBatchService } = require('./services/batch');
const { createProviderConfig } = require('./services/providerConfig');
const jobs = require('./domain/jobs');
const { createRouter, sendJson, sendFile } = require('./http/router');
const { registerRoutes } = require('./http/routes');
const { runPreproduction } = require('./agents/producer');
const { buildBrief } = require('./agents/idea');
const workflow = require('./workflow');

const log = createLogger('server');

const config = createConfig();
const storage = createStorage(config);
// 运行时保存的模型配置（data/config/providers.json）优先于 env.yaml，必须在建注册表之前应用
createProviderConfig({ storage }).apply(config);
const providers = createRegistry(config);
// 必须在 storage 创建之后再注入，否则会踩 const 暂时性死区
workflow.setStorage(storage);
const gallery = createGalleryService({ storage });
const batch = createBatchService({ config, providers, storage, jobs });

jobs.setPersistence(job => storage.saveJob(job));

const router = createRouter();
registerRoutes({
    router,
    config,
    storage,
    providers,
    gallery,
    batch,
    jobs,
    pipeline: { buildBrief, runPreproduction, workflow }
});

const WEB_ROOT = path.resolve(path.join(__dirname, '..', 'web'));

function serveStatic(res, pathname) {
    let relative;
    try {
        relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch (error) {
        return sendJson(res, 400, { success: false, message: '非法路径' });
    }
    const filePath = path.resolve(WEB_ROOT, relative);
    if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + path.sep)) {
        return sendJson(res, 403, { success: false, message: '禁止访问' });
    }
    return sendFile({ headers: {} }, res, filePath);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
        const hit = router.match(req.method, url.pathname);
        if (!hit) return sendJson(res, 404, { success: false, message: '接口不存在' });
        try {
            return await hit.handler({ req, res, params: hit.params, query: url.searchParams });
        } catch (error) {
            log.error(`${req.method} ${url.pathname} 处理失败: ${error.message}`);
            if (!res.headersSent) return sendJson(res, 500, { success: false, message: error.message });
            return res.end();
        }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { success: false, message: '方法不允许' });
    }
    return serveStatic(res, url.pathname);
});

server.listen(config.port, () => {
    const summary = describeConfig(config);
    const described = providers.describe();
    log.info('========================================');
    log.info('生长相册 GrowAlbum 已启动');
    log.info(`控制台: http://localhost:${config.port}`);
    log.info(`产物目录: ${config.outputRoot}`);
    log.info(`成片规格: ${config.video.width}x${config.video.height} / ${config.video.totalSeconds}s / ${config.video.shots} 镜头`);
    log.info(`运行模式: ${summary.mode}`);
    log.info(`provider: llm=${described.llm.id}(${described.llm.enabled}) image=${described.image.id}(${described.image.enabled}) tts=${described.tts.id}(${described.tts.enabled})`);
    log.info(`工作流模板: ${workflow.listTemplates().map(item => item.id).join(', ')}`);
    log.info('========================================');
});

function shutdown(signal) {
    log.info(`收到 ${signal}，正在关闭服务`);
    server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
