'use strict';

const { describeConfig } = require('../config');
const { normalizeBrief } = require('../domain/brief');
const { createProject } = require('../domain/project');
const {
    normalizePreset, withBuiltins, groupPresets, SLOT_LABELS, SLOT_ORDER
} = require('../domain/preset');
const ffmpeg = require('../services/ffmpeg');
const { createVisionService } = require('../services/vision');
const { createAnalyticsService } = require('../services/analytics');
const { createProviderConfig, maskKey } = require('../services/providerConfig');
const { createRegistry } = require('../providers/registry');
const { sendJson, sendFile, readJsonBody, readRawBody } = require('./router');
const { createLogger } = require('../logger');

const log = createLogger('http');

/** 模型状态以 provider 注册表为唯一来源（前端 health 面板用） */
function modelsSnapshot(providers) {
    const described = providers.describe();
    const pick = kind => ({
        enabled: described[kind].enabled,
        provider: described[kind].id,
        label: described[kind].label,
        model: described[kind].model
    });
    return { llm: pick('llm'), image: pick('image'), i2v: pick('i2v'), tts: pick('tts') };
}

/**
 * 递归合并纯对象（数组整体替换）。
 * 节点参数里 slots 这类嵌套对象如果浅合并，改一个槽位会把同级的其它槽位冲掉。
 */
function mergeParams(base, patch) {
    const out = { ...(base || {}) };
    for (const [key, value] of Object.entries(patch || {})) {
        const current = out[key];
        const bothPlain = current && value
            && typeof current === 'object' && typeof value === 'object'
            && !Array.isArray(current) && !Array.isArray(value);
        out[key] = bothPlain ? mergeParams(current, value) : value;
    }
    return out;
}

function summarizeProject(project) {
    return {
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.createdAt,
        targetDuration: project.targetDuration,
        shotCount: project.shots?.length || 0,
        genre: project.brief?.genre || project.script?.genre || null,
        briefId: project.briefId || null,
        scriptSource: project.script?.source || null,
        workflow: project.workflow ? { templateId: project.workflow.templateId, templateName: project.workflow.templateName } : null,
        logline: project.script?.logline || project.brief?.logline || '',
        poster: project.outputs?.poster || null,
        // 没渲染的项目也能有封面：用第一张关键帧的缩略图
        keyframe: (project.assets?.keyframes || []).find(item => item && item.thumb)?.thumb || null,
        video: project.outputs?.video || null
    };
}

function registerRoutes({ router, config, storage, providers, jobs, gallery, batch, pipeline }) {
    const { workflow, buildBrief, runPreproduction } = pipeline;
    // 视觉模型复用百炼网关与同一把 Key
    const vision = createVisionService({
        baseUrl: config.models.image?.baseUrl,
        apiKey: config.models.image?.apiKey,
        model: process.env.DASHSCOPE_VISION_MODEL || 'qwen3-vl-plus'
    });
    const analytics = createAnalyticsService({ storage });
    const providerConfig = createProviderConfig({ storage });

    const resolveProjectNodes = project => {
        const template = workflow.getTemplate(project.workflow?.templateId || config.workflow.defaultTemplate);
        const entries = workflow.projectEntries(project, template);
        return { template, nodes: workflow.resolveNodes(template, project.workflow?.overrides || {}, entries) };
    };

    // ---------------- 系统 ----------------
    router.get('/api/health', async ({ res }) => {
        let ffmpegVersion;
        try {
            ffmpegVersion = await ffmpeg.probeVersion();
        } catch (error) {
            ffmpegVersion = `不可用: ${error.message}`;
        }
        sendJson(res, 200, {
            success: true,
            ffmpeg: ffmpegVersion,
            subtitleFont: ffmpeg.findCjkFont(),
            uptimeSeconds: Math.round(process.uptime()),
            models: modelsSnapshot(providers),
            providers: providers.describe()
        });
    });

    router.get('/api/config', async ({ res }) => {
        sendJson(res, 200, {
            success: true,
            config: {
                ...describeConfig(config),
                workflow: config.workflow,
                providers: providers.describe()
            }
        });
    });

    router.get('/api/providers', async ({ res }) => {
        sendJson(res, 200, { success: true, providers: providers.describe(), catalog: providers.catalog() });
    });

    // ---------------- 模型接入配置 ----------------
    function providerSummary() {
        const described = providers.describe();
        const saved = providerConfig.load();
        return Object.entries(described).map(([kind, info]) => ({
            kind,
            kindLabel: info.kindLabel,
            provider: info.id,
            label: info.label,
            model: info.model,
            enabled: info.enabled,
            available: info.available,
            savedKeyMasked: saved[kind]?.apiKey ? maskKey(saved[kind].apiKey) : ''
        }));
    }

    router.get('/api/config/providers', async ({ res }) => {
        sendJson(res, 200, { success: true, providers: providerSummary(), configFile: providerConfig.file });
    });

    // 保存某个环节的模型配置并热加载（不用重启容器）
    router.post('/api/config/providers', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const kind = String(body.kind || '');
        if (!['llm', 'image', 'i2v', 'tts'].includes(kind)) {
            return sendJson(res, 400, { success: false, message: 'kind 必须是 llm / image / i2v / tts' });
        }
        const patch = {};
        for (const field of ['provider', 'apiKey', 'accessKey', 'secretKey', 'baseUrl', 'model', 'size', 'resolution', 'voice']) {
            if (body[field] !== undefined && body[field] !== '') patch[field] = String(body[field]).trim();
        }
        providerConfig.save(kind, patch);
        providerConfig.apply(config);
        providers.reload(createRegistry(config));
        sendJson(res, 200, { success: true, providers: providerSummary() });
    });

    // 连通性/鉴权自检：只做只读探测，不消耗生成额度
    router.post('/api/providers/:kind/test', async ({ res, params }) => {
        const provider = providers.get(params.kind);
        if (!provider) return sendJson(res, 404, { success: false, message: `未知 provider 类型 ${params.kind}` });
        try {
            if (typeof provider.test === 'function') {
                const result = await provider.test();
                return sendJson(res, 200, { success: true, result });
            }
            const check = provider.canRun ? provider.canRun() : { ok: true };
            return sendJson(res, 200, {
                success: true,
                result: { ok: check.ok !== false, message: check.reason || '该 provider 无自检实现，仅校验配置是否齐全' }
            });
        } catch (error) {
            return sendJson(res, 200, { success: true, result: { ok: false, message: error.message } });
        }
    });

    // ---------------- 工作流 ----------------
    router.get('/api/workflows', async ({ res }) => {
        sendJson(res, 200, {
            success: true,
            templates: workflow.listTemplates(),
            defaultTemplate: config.workflow.defaultTemplate
        });
    });

    router.get('/api/workflows/:id', async ({ res, params }) => {
        sendJson(res, 200, { success: true, template: workflow.describeTemplate(params.id) });
    });

    // 节点库清单：工作流编辑器「添加节点」从这里挑
    router.get('/api/workflow/nodes', async ({ res }) => {
        sendJson(res, 200, { success: true, nodes: workflow.describeLibrary() });
    });

    // 删除自定义模板（内置模板由 deleteTemplate 拦住）
    router.delete('/api/workflows/:id', async ({ res, params }) => {
        try {
            const removed = workflow.deleteTemplate(params.id);
            if (!removed) return sendJson(res, 404, { success: false, message: `模板 ${params.id} 不存在` });
            sendJson(res, 200, { success: true, message: `模板「${removed.name}」已删除` });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    // 重命名 / 改描述自定义模板
    router.post('/api/workflows/:id', async ({ req, res, params }) => {
        const body = await readJsonBody(req);
        try {
            const template = workflow.updateTemplate(params.id, { name: body.name, description: body.description });
            if (!template) return sendJson(res, 404, { success: false, message: `模板 ${params.id} 不存在` });
            sendJson(res, 200, { success: true, template: { id: template.id, name: template.name, description: template.description } });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    // 存为我的模板：把项目当前的节点启停与参数固化成可复用模板
    router.post('/api/workflows', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const project = storage.getProject(String(body.projectId || ''));
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        try {
            const template = workflow.saveTemplateFromProject(project, {
                name: body.name ? String(body.name).trim() : '',
                description: body.description ? String(body.description).trim() : ''
            });
            sendJson(res, 201, { success: true, template });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    // ---------------- 创意模块 ----------------
    router.post('/api/ideas', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const idea = String(body.idea || '').trim();
        if (!idea) return sendJson(res, 400, { success: false, message: '请填写创意（idea）' });

        const brief = await buildBrief({
            idea,
            title: body.title ? String(body.title).trim() : '',
            video: config.video,
            llm: providers.get('llm')
        });
        storage.saveBrief(brief);
        sendJson(res, 200, { success: true, brief });
    });

    router.get('/api/ideas', async ({ res }) => {
        sendJson(res, 200, { success: true, briefs: storage.listBriefs() });
    });

    router.get('/api/ideas/:id', async ({ res, params }) => {
        const brief = storage.getBrief(params.id);
        if (!brief) return sendJson(res, 404, { success: false, message: '创意简报不存在' });
        sendJson(res, 200, { success: true, brief });
    });

    router.post('/api/ideas/:id', async ({ req, res, params }) => {
        const body = await readJsonBody(req);
        const existing = storage.getBrief(params.id);
        if (!existing) return sendJson(res, 404, { success: false, message: '创意简报不存在' });

        const brief = normalizeBrief(
            { ...existing, ...body, id: existing.id, createdAt: existing.createdAt },
            { video: config.video }
        );
        storage.saveBrief(brief);

        const synced = [];
        for (const project of storage.listProjects()) {
            if (project.briefId !== brief.id) continue;
            project.brief = brief;
            storage.saveProject(project);
            storage.writeJson(storage.paths(project.id).briefFile, brief);
            synced.push(project.id);
        }
        sendJson(res, 200, { success: true, brief, syncedProjects: synced });
    });

    // ---------------- 提示词库 ----------------
    const readPresets = () => withBuiltins(storage.loadPresets());

    // ---------------- 个人相册 ----------------
    router.get('/api/gallery/albums', async ({ res }) => {
        sendJson(res, 200, { success: true, albums: gallery.listAlbums() });
    });

    router.post('/api/gallery/albums', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const album = gallery.createAlbum(body);
        sendJson(res, 201, { success: true, album });
    });

    router.delete('/api/gallery/albums/:id', async ({ res, params }) => {
        const album = gallery.getAlbum(params.id);
        if (!album) return sendJson(res, 404, { success: false, message: '相册不存在' });
        gallery.deleteAlbum(params.id);
        sendJson(res, 200, { success: true, message: `相册「${album.name}」及其照片已删除` });
    });

    router.get('/api/gallery/albums/:id/photos', async ({ res, params }) => {
        if (!gallery.getAlbum(params.id)) return sendJson(res, 404, { success: false, message: '相册不存在' });
        sendJson(res, 200, { success: true, photos: gallery.photosOf(params.id) });
    });

    // 上传单张照片：请求体就是文件二进制（前端逐张上传）
    router.post('/api/gallery/albums/:id/photos', async ({ req, res, params, query }) => {
        const album = gallery.getAlbum(params.id);
        if (!album) return sendJson(res, 404, { success: false, message: '相册不存在' });
        try {
            const buffer = await readRawBody(req);
            const photo = await gallery.addPhoto({
                albumId: album.id,
                name: query.get('name') || 'photo.jpg',
                note: query.get('note') || '',
                source: query.get('source') || 'upload',
                buffer
            });
            sendJson(res, 201, { success: true, photo });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    router.post('/api/gallery/photos/:id', async ({ req, res, params }) => {
        const body = await readJsonBody(req);
        const photo = gallery.updatePhoto(params.id, body);
        if (!photo) return sendJson(res, 404, { success: false, message: '照片不存在' });
        sendJson(res, 200, { success: true, photo });
    });

    router.delete('/api/gallery/photos/:id', async ({ res, params }) => {
        const removed = gallery.deletePhoto(params.id);
        if (!removed) return sendJson(res, 404, { success: false, message: '照片不存在' });
        sendJson(res, 200, { success: true });
    });

    // 一键出片：用相册生成 MV（创建项目 + 自动开始渲染）
    router.post('/api/gallery/albums/:id/mv', async ({ req, res, params }) => {
        const album = gallery.getAlbum(params.id);
        if (!album) return sendJson(res, 404, { success: false, message: '相册不存在' });
        if (!gallery.photosOf(album.id).length) return sendJson(res, 400, { success: false, message: '相册里还没有照片' });

        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (error) {
            body = {};
        }

        const template = workflow.getTemplate('album-mv-15s');
        const project = createProject({
            id: storage.newProjectId(),
            idea: `${album.name} 相册 MV`,
            title: body.title ? String(body.title).trim() : album.name,
            video: config.video,
            style: null
        });
        project.workflow = {
            templateId: template.id,
            overrides: {
                album_mv: {
                    enabled: true,
                    params: {
                        albumId: album.id,
                        pick: body.pick || 'sequential',
                        caption: body.caption || 'note'
                    }
                }
            }
        };
        storage.ensureProjectDirs(project.id);
        storage.saveProject(project);

        const nodes = workflow.resolveNodes(template, project.workflow.overrides);
        const steps = workflow.stepsForStage(nodes, 'render');
        const job = jobs.createJob('render', project.id, steps);
        sendJson(res, 202, { success: true, projectId: project.id, jobId: job.id, project: summarizeProject(project) });
        runJob({ project, template, stage: 'render', job, label: '相册 MV' });
    });

    router.get('/api/presets/export', async ({ res }) => {
        const presets = readPresets().map(({ builtin, ...rest }) => rest);
        sendJson(res, 200, { success: true, version: 1, presets });
    });

    router.get('/api/presets', async ({ res }) => {
        const presets = readPresets();
        storage.savePresets(presets);
        sendJson(res, 200, {
            success: true,
            presets,
            groups: groupPresets(presets),
            slotLabels: SLOT_LABELS,
            slotOrder: SLOT_ORDER
        });
    });

    // 风格反推：从你自己的图里提炼画风，直接落成 style 预设
    // 相册 → 故事：用素材本身写剧本，可直接立项
    router.post('/api/gallery/albums/:id/story', async ({ req, res, params }) => {
        const album = gallery.getAlbum(params.id);
        if (!album) return sendJson(res, 404, { success: false, message: '相册不存在' });
        const photos = gallery.photosOf(album.id);
        if (!photos.length) return sendJson(res, 400, { success: false, message: '相册里还没有照片' });

        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (error) {
            body = {};
        }

        try {
            const story = await vision.writeStoryFromImages({
                imagePaths: photos.map(photo => photo.file),
                shots: Number(body.shots) > 0 ? Number(body.shots) : 5
            });
            let project = null;
            if (body.createProject) {
                const created = await runPreproduction({
                    idea: `${story.title}：${story.logline}`,
                    title: story.title,
                    brief: {
                        raw: `${story.title}：${story.logline}`,
                        title: story.title,
                        logline: story.logline,
                        genre: '都市悬疑',
                        source: 'album'
                    },
                    templateId: body.templateId || 'vertical-15s',
                    config,
                    providers,
                    storage
                });
                project = summarizeProject(created);
                // 相册 → 故事：立项时就把画面来源绑成这个相册（按分数优先），
                // 否则这条路会退化成"照片只当灵感、关键帧仍由模型生成"
                const storyTemplate = workflow.getTemplate(created.workflow?.templateId || config.workflow.defaultTemplate);
                created.workflow = created.workflow || { templateId: storyTemplate.id, overrides: {} };
                created.workflow.overrides = created.workflow.overrides || {};
                created.workflow.overrides.image_source = {
                    enabled: true,
                    params: { mode: 'album', albumId: album.id, pick: 'score' }
                };
                storage.saveProject(created);
                await workflow.runStage({
                    project: created, template: storyTemplate, stage: 'pre',
                    onlyNodeId: 'image_source', config, providers, storage
                });
                storage.saveProject(created);
                project = summarizeProject(created);
            }
            sendJson(res, 200, { success: true, album: album.name, story, project });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    // 打分任务化：立刻返回 jobId，后台逐张打分，可随时取消（GET /api/jobs/:id 看进度）
    router.post('/api/gallery/albums/:id/score', async ({ req, res, params }) => {
        const album = gallery.getAlbum(params.id);
        if (!album) return sendJson(res, 404, { success: false, message: '相册不存在' });
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (error) {
            body = {};
        }
        const purpose = body.purpose || '竖屏短片的钩子镜头';
        const onlyUnscored = body.onlyUnscored !== false;
        const limit = Number(body.limit) > 0 ? Number(body.limit) : 0;

        let pending = gallery.photosOf(album.id);
        if (onlyUnscored) pending = pending.filter(photo => photo.score === undefined || photo.score === null);
        if (limit) pending = pending.slice(0, limit);
        if (!pending.length) {
            return sendJson(res, 200, { success: true, message: '所有照片都已打分', remaining: 0 });
        }

        const job = jobs.createJob('score', `album:${album.id}`, ['score']);
        job.total = pending.length;
        job.done = 0;
        job.items = [];
        sendJson(res, 202, { success: true, jobId: job.id, total: pending.length, purpose });

        // 后台逐张打分：每张之间检查取消标志，取消后已打的分保留
        (async () => {
            jobs.setStatus(job, 'running');
            jobs.appendLog(job, `开始打分：${pending.length} 张（${purpose}）`);
            for (const photo of pending) {
                if (job.cancelRequested) {
                    job.canceled = true;
                    jobs.appendLog(job, `已取消，完成 ${job.done}/${job.total}`);
                    jobs.setStatus(job, 'canceled');
                    return;
                }
                try {
                    const verdict = await vision.scoreImage({ imagePath: photo.file, purpose });
                    gallery.updatePhoto(photo.id, { score: verdict.score, reason: verdict.reason, scoredAt: new Date().toISOString() });
                    job.items.push({ photoId: photo.id, score: verdict.score, reason: verdict.reason, status: 'done' });
                } catch (error) {
                    job.items.push({ photoId: photo.id, status: 'failed', error: error.message });
                    jobs.appendLog(job, `照片 ${photo.id} 打分失败：${error.message}`);
                }
                job.done += 1;
                job.progress = Math.round((job.done / job.total) * 100);
                jobs.appendLog(job, `已打分 ${job.done}/${job.total}（${photo.note || photo.id}）`);
            }
            jobs.setStatus(job, 'succeeded');
            jobs.appendLog(job, `打分完成：${job.done}/${job.total}`);
        })();
    });

    // 取消任务（打分这类批处理会在下一张之前停下）
    router.post('/api/jobs/:id/cancel', async ({ res, params }) => {
        const job = jobs.getJob(params.id);
        if (!job) return sendJson(res, 404, { success: false, message: '任务不存在' });
        job.cancelRequested = true;
        jobs.appendLog(job, '已请求取消');
        sendJson(res, 200, { success: true, jobId: job.id, status: job.status });
    });

    // 智能选图：给相册里的图打分排序，用于挑钩子镜头 / 封面
    router.post('/api/gallery/albums/:id/pick', async ({ req, res, params }) => {
        const album = gallery.getAlbum(params.id);
        if (!album) return sendJson(res, 404, { success: false, message: '相册不存在' });
        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (error) {
            body = {};
        }
        const count = Number(body.count) > 0 ? Number(body.count) : 3;
        const limit = Number(body.limit) > 0 ? Number(body.limit) : 8; // 控制打分张数，压成本
        const purpose = body.purpose || '竖屏短剧的钩子镜头';
        const photos = gallery.photosOf(album.id).slice(0, limit);
        if (!photos.length) return sendJson(res, 400, { success: false, message: '相册里还没有照片' });

        try {
            const scored = [];
            const queue = [...photos];
            await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
                while (queue.length) {
                    const photo = queue.shift();
                    try {
                        const result = await vision.scoreImage({ imagePath: photo.file, purpose });
                        scored.push({ photoId: photo.id, note: photo.note, thumb: photo.thumb, file: photo.file, ...result });
                    } catch (error) {
                        scored.push({ photoId: photo.id, note: photo.note, thumb: photo.thumb, file: photo.file, score: 0, reason: error.message });
                    }
                }
            }));
            scored.sort((a, b) => b.score - a.score);
            // 把分数回写到照片记录：这样出片时选「按分数优先」才有据可依
            const scoredAt = new Date().toISOString();
            for (const item of scored) {
                gallery.updatePhoto(item.photoId, { score: item.score, reason: item.reason, scoredAt });
            }
            sendJson(res, 200, { success: true, purpose, count, ranked: scored, top: scored.slice(0, count) });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    router.post('/api/presets/from-image', async ({ req, res }) => {
        const body = await readJsonBody(req);
        let imagePath = null;
        let label = '';

        if (body.photoId) {
            for (const album of gallery.listAlbums()) {
                const photo = gallery.photosOf(album.id).find(item => item.id === String(body.photoId));
                if (photo) {
                    imagePath = photo.file;
                    label = photo.note || photo.name || '';
                    break;
                }
            }
            if (!imagePath) return sendJson(res, 404, { success: false, message: '照片不存在' });
        } else if (body.path) {
            imagePath = storage.resolveOutputFile(body.path);
        } else {
            return sendJson(res, 400, { success: false, message: '需要 photoId 或 path' });
        }

        try {
            const description = await vision.describeStyle(imagePath);
            const presets = readPresets();
            const preset = normalizePreset({
                group: 'style',
                name: String(body.name || `反推·${(label || '风格').slice(0, 6)}`).slice(0, 20),
                text: description,
                weight: 60
            });
            presets.push({ ...preset, builtin: false });
            storage.savePresets(presets);
            sendJson(res, 201, { success: true, preset, description });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    router.post('/api/presets/import', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const incoming = Array.isArray(body.presets) ? body.presets : [];
        if (!incoming.length) return sendJson(res, 400, { success: false, message: '没有可导入的预设' });

        const presets = readPresets();
        const existing = new Set(presets.map(item => item.id));
        let added = 0;
        for (const item of incoming) {
            const preset = normalizePreset(item);
            // 导入的同名 id 视为更新文本，避免覆盖内置项的名称
            const index = presets.findIndex(local => local.id === preset.id);
            if (index >= 0) {
                presets[index] = { ...presets[index], text: preset.text, name: preset.name, weight: preset.weight };
            } else {
                presets.push({ ...preset, builtin: false });
                added += 1;
            }
            existing.add(preset.id);
        }
        storage.savePresets(presets);
        sendJson(res, 200, { success: true, added, total: presets.length, presets });
    });

    router.post('/api/presets', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const presets = readPresets();
        const preset = normalizePreset({ ...body, createdAt: new Date().toISOString() });
        if (presets.some(item => item.id === preset.id)) {
            return sendJson(res, 409, { success: false, message: `预设 id ${preset.id} 已存在` });
        }
        presets.push({ ...preset, builtin: false });
        storage.savePresets(presets);
        sendJson(res, 201, { success: true, preset, presets });
    });

    router.post('/api/presets/:id', async ({ req, res, params }) => {
        const body = await readJsonBody(req);
        const presets = readPresets();
        const index = presets.findIndex(item => item.id === params.id);
        if (index < 0) return sendJson(res, 404, { success: false, message: '预设不存在' });
        const merged = normalizePreset({ ...presets[index], ...body, id: presets[index].id, createdAt: presets[index].createdAt });
        presets[index] = { ...merged, builtin: presets[index].builtin };
        storage.savePresets(presets);
        sendJson(res, 200, { success: true, preset: presets[index], presets });
    });

    router.delete('/api/presets/:id', async ({ res, params }) => {
        const presets = readPresets();
        const target = presets.find(item => item.id === params.id);
        if (!target) return sendJson(res, 404, { success: false, message: '预设不存在' });
        if (target.builtin) {
            return sendJson(res, 400, { success: false, message: '内置预设不可删除，可以改成停用' });
        }
        const next = presets.filter(item => item.id !== params.id);
        storage.savePresets(next);
        sendJson(res, 200, { success: true, presets: next });
    });

    // ---------------- 用相册出片 ----------------
    // 把某个相册设为画面来源（选图策略可选），并把结果写进每个镜头
    router.post('/api/projects/:id/use-album', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const body = await readJsonBody(req);
        const album = gallery.getAlbum(String(body.albumId || ''));
        if (!album) return sendJson(res, 404, { success: false, message: '相册不存在' });
        if (!gallery.photosOf(album.id).length) return sendJson(res, 400, { success: false, message: '相册里还没有照片' });

        const template = workflow.getTemplate(project.workflow?.templateId || config.workflow.defaultTemplate);
        project.workflow = project.workflow || { templateId: template.id, overrides: {} };
        project.workflow.overrides = project.workflow.overrides || {};
        project.workflow.overrides.image_source = {
            enabled: true,
            params: { mode: 'album', albumId: album.id, pick: body.pick || 'sequential' }
        };
        storage.saveProject(project);

        // 只跑 image_source 这一个节点：它不调模型，只是把照片分给每个镜头，毫秒级完成
        // （重跑整个前期阶段会连带 3 次模型调用，容易超时且没必要）
        await workflow.runStage({
            project, template, stage: 'pre', onlyNodeId: 'image_source', config, providers, storage
        });
        storage.saveProject(project);
        sendJson(res, 200, {
            success: true,
            album: album.name,
            shots: (project.shots || []).map(shot => ({ shot_id: shot.shot_id, image_source: shot.image_source, source_label: shot.source_label || null }))
        });
    });

    // ---------------- 审核 ----------------
    // 视觉审核 + 图文一致性：复用视觉模型，一次调用同时判风险与文不对图
    router.post('/api/projects/:id/review', async ({ res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const keyframes = (project.assets?.keyframes || []).filter(item => item?.path);
        if (!keyframes.length) return sendJson(res, 400, { success: false, message: '还没有关键帧可审核' });

        try {
            const result = await vision.auditProject({
                imagePaths: keyframes.map(item => item.path),
                captions: (project.shots || []).map(shot => ({ shot_id: shot.shot_id, caption: shot.caption }))
            });
            project.review = { ...result, checkedAt: new Date().toISOString(), frames: keyframes.length };
            storage.saveProject(project);
            sendJson(res, 200, { success: true, review: project.review });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    // ---------------- 发布包 ----------------
    // 生成可发布的文案包（标题/简介/标签/封面文案 + AI 生成标识），并落盘到项目输出目录
    router.post('/api/projects/:id/publish', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        if (!project.outputs?.video) return sendJson(res, 400, { success: false, message: '还没有成片，先渲染再生成发布包' });

        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (error) {
            body = {};
        }
        const platform = String(body.platform || '通用');
        const brief = project.brief || {};
        const script = project.script || {};
        const base = brief.title || project.name || '短片';
        const keywords = brief.keywords || [];

        const pack = {
            platform,
            generatedAt: new Date().toISOString(),
            titles: [
                base,
                `${base}｜${(brief.hook || '最后三秒反转').slice(0, 12)}`,
                `${(brief.hook || '看到最后').slice(0, 12)}，你猜到了吗`
            ].slice(0, 3),
            intro: (script.logline || brief.logline || '').slice(0, 50),
            cover: base.slice(0, 6),
            tags: [...new Set([brief.genre || script.genre || '短片', 'AIGC', 'AI生成', ...keywords])].slice(0, 10),
            aiDisclosure: '本片由 AI 生成（画面、配音、剪辑均为 AIGC 辅助制作）',
            platformTips: {
                抖音: '竖屏 9:16；标题前 8 字是站内搜索关键；建议加 #AIGC 话题并声明 AI 生成',
                快手: '封面文案控制在 6 字内；完播率权重高，前 3 秒不要放片头',
                B站: '标题可长一些，建议加「AI 短片」分区；简介里写清生成方式',
                通用: '竖屏 9:16；发布时勾选平台的「AI 生成内容」声明'
            }[platform] || '竖屏 9:16；发布时勾选平台的「AI 生成内容」声明',
            video: project.outputs.video,
            poster: project.outputs.poster,
            duration: project.outputs.duration,
            resolution: project.outputs.resolution
        };

        project.publishPack = pack;
        // AI 生成标识写入文件元数据（平台合规留痕）：重封装一版带 metadata 的成片
        try {
            const { execFile } = require('child_process');
            const path = require('path');
            const stampedVideo = path.join(storage.paths(project.id).output, `publish_${project.id}.mp4`);
            await new Promise((resolve, reject) => {
                execFile('ffmpeg', [
                    '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', project.outputs.video,
                    '-c', 'copy',
                    '-metadata', `title=${pack.titles[0]}`,
                    '-metadata', `comment=${pack.aiDisclosure}`,
                    '-metadata', `description=${pack.intro}`,
                    '-metadata', 'encoded_by=GrowAlbum (AIGC)',
                    '-movflags', '+faststart',
                    stampedVideo
                ], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()));
            });
            pack.stampedVideo = stampedVideo;
        } catch (error) {
            pack.stampError = error.message;
        }
        storage.saveProject(project);
        storage.writeJson(require('path').join(storage.paths(project.id).output, 'publish.json'), pack);
        sendJson(res, 200, { success: true, pack });
    });

    // ---------------- 数据闭环 ----------------
    // 回填投放数据（播放量 / 完播率 / 点赞）
    router.post('/api/projects/:id/metrics', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const body = await readJsonBody(req);
        const metrics = analytics.record(project, body);
        sendJson(res, 200, { success: true, metrics });
    });

    // 预设效果排行
    router.get('/api/analytics/presets', async ({ res, query }) => {
        const slot = query.get('slot') || 'style';
        sendJson(res, 200, {
            success: true,
            slot,
            ranking: analytics.presetRanking({ slot }),
            scored: storage.listProjects().filter(project => project.metrics?.score).length
        });
    });

    // 推荐新项目开局用哪几个预设
    router.get('/api/analytics/recommend', async ({ res, query }) => {
        const slot = query.get('slot') || 'style';
        const limit = Number(query.get('limit')) > 0 ? Number(query.get('limit')) : 3;
        const ranking = analytics.presetRanking({ slot });
        sendJson(res, 200, {
            success: true,
            slot,
            recommend: ranking.slice(0, limit).map(item => ({ id: item.id, name: item.name, avgScore: item.avgScore, samples: item.samples })),
            basis: ranking.length ? `基于 ${ranking.reduce((sum, item) => sum + item.samples, 0)} 条项目数据` : '还没有回填过投放数据'
        });
    });

    // ---------------- 批量生产 ----------------
    router.post('/api/batch', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const raw = Array.isArray(body.ideas) ? body.ideas : String(body.ideas || body.text || '').split('\n');
        const ideas = raw.map(item => String(item || '').trim()).filter(Boolean).slice(0, 20);
        if (!ideas.length) return sendJson(res, 400, { success: false, message: '至少给一条创意（ideas 数组或换行文本）' });

        const started = await batch.start({ ideas, templateId: body.templateId });
        sendJson(res, 202, {
            success: true,
            batchId: started.id,
            count: started.items.length,
            items: started.items.map(item => ({ idea: item.idea, name: item.name, projectId: item.projectId, status: item.status }))
        });
    });

    router.get('/api/batch', async ({ res }) => {
        sendJson(res, 200, {
            success: true,
            batches: batch.list().map(item => ({
                id: item.id, status: item.status, count: item.items.length,
                spendYuan: item.spendYuan, createdAt: item.createdAt
            }))
        });
    });

    router.get('/api/batch/:id', async ({ res, params }) => {
        const found = batch.get(params.id);
        if (!found) return sendJson(res, 404, { success: false, message: '批次不存在' });
        sendJson(res, 200, { success: true, batch: found });
    });

    // ---------------- 项目 ----------------
    router.get('/api/projects', async ({ res }) => {
        sendJson(res, 200, { success: true, projects: storage.listProjects().map(summarizeProject) });
    });

    router.post('/api/projects', async ({ req, res }) => {
        const body = await readJsonBody(req);
        const idea = String(body.idea || '').trim();

        let incomingBrief = null;
        if (body.briefId) {
            incomingBrief = storage.getBrief(String(body.briefId));
            if (!incomingBrief) return sendJson(res, 404, { success: false, message: '创意简报不存在' });
        } else if (body.brief && typeof body.brief === 'object') {
            incomingBrief = body.brief;
        }
        if (!incomingBrief && !idea) {
            return sendJson(res, 400, { success: false, message: '请填写创意（idea），或先解析出 brief' });
        }

        try {
            const project = await runPreproduction({
                idea,
                title: body.title ? String(body.title).trim() : '',
                brief: incomingBrief,
                templateId: body.templateId,
                config,
                providers,
                storage
            });
            sendJson(res, 201, { success: true, project: summarizeProject(project) });
        } catch (error) {
            log.error(`立项失败: ${error.message}`);
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    router.get('/api/projects/:id', async ({ res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        sendJson(res, 200, { success: true, project });
    });

    router.delete('/api/projects/:id', async ({ res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        if (project.status === 'rendering') return sendJson(res, 409, { success: false, message: '项目正在渲染，无法删除' });
        const removed = storage.deleteProject(params.id);
        sendJson(res, 200, { success: true, message: removed ? `项目 ${params.id} 及其产物已删除` : '项目目录不存在，已忽略' });
    });

    router.get('/api/projects/:id/download', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project?.outputs?.video) return sendJson(res, 404, { success: false, message: '成片尚未生成' });
        return sendFile(req, res, project.outputs.video, { download: true });
    });

    // 用当前（或传入的）Brief 重跑前期链路，项目 ID 与创意保留
    router.post('/api/projects/:id/preproduction', async ({ req, res, params }) => {
        const existing = storage.getProject(params.id);
        if (!existing) return sendJson(res, 404, { success: false, message: '项目不存在' });
        if (existing.status === 'rendering') return sendJson(res, 409, { success: false, message: '项目正在渲染，无法重新生成' });

        const body = await readJsonBody(req);
        try {
            const project = await runPreproduction({
                idea: body.idea || existing.brief?.raw || existing.initialIdea || '',
                brief: body.brief || existing.brief || null,
                templateId: body.templateId,
                projectId: existing.id,
                config,
                providers,
                storage
            });
            sendJson(res, 200, { success: true, project });
        } catch (error) {
            sendJson(res, 400, { success: false, message: error.message });
        }
    });

    // ---------------- 渲染 / 单节点重跑 ----------------
    function runJob({ project, template, stage, onlyNodeId, job, label }) {
        workflow.runStage({ project, template, stage, onlyNodeId, config, providers, storage, job, jobs })
            .then(result => {
                // 人工闸门暂停：保持 awaiting_selection，别被收尾逻辑冲成「已完成」
                if (result?.paused) {
                    jobs.appendLog(job, '等待选择方向：到「方向对比」选定后再点渲染继续');
                    return;
                }
                if (onlyNodeId) {
                    job.result = { node: onlyNodeId };
                } else {
                    project.status = project.outputs?.video ? 'completed' : 'storyboard_ready';
                    storage.saveProject(project);
                    job.result = project.outputs;
                    jobs.appendLog(job, project.outputs?.video ? `成片完成：${project.outputs.video}` : '渲染完成（未产出成片）');
                }
                jobs.setStatus(job, 'succeeded');
            })
            .catch(error => {
                log.error(`${label} 失败: ${error.message}`, { stderr: (error.stderr || '').slice(-500) });
                job.error = error.message;
                job.result = null;
                jobs.setStatus(job, 'failed');
                const latest = storage.getProject(project.id);
                if (latest) {
                    latest.status = 'failed';
                    latest.error = error.message;
                    storage.saveProject(latest);
                }
            });
    }

    router.post('/api/projects/:id/render', async ({ res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        if (project.status === 'rendering') return sendJson(res, 409, { success: false, message: '该项目正在渲染中' });

        const { template, nodes } = resolveProjectNodes(project);
        // 必须把 project 传进去：否则"用完整 Brief 立项（brief 节点停用）"的项目会被误判为上游缺失
        const validation = workflow.validateChain(nodes, project);
        if (!validation.ok) return sendJson(res, 400, { success: false, message: `工作流校验失败：${validation.problems.join('；')}` });

        const steps = workflow.stepsForStage(nodes, 'render');
        if (!steps.length) return sendJson(res, 400, { success: false, message: '当前工作流的渲染阶段没有启用任何节点' });

        project.status = 'rendering';
        storage.saveProject(project);

        const job = jobs.createJob('render', project.id, steps);
        sendJson(res, 202, { success: true, jobId: job.id, job });
        runJob({ project, template, stage: 'render', job, label: '渲染' });
    });

    router.post('/api/projects/:id/nodes/:nodeId/rerun', async ({ res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        if (project.status === 'rendering') return sendJson(res, 409, { success: false, message: '该项目正在渲染中' });

        const { template, nodes } = resolveProjectNodes(project);
        const node = nodes.find(item => item.id === params.nodeId);
        if (!node) return sendJson(res, 404, { success: false, message: `节点 ${params.nodeId} 不在当前工作流里` });
        if (!node.enabled) return sendJson(res, 400, { success: false, message: `节点 ${params.nodeId} 在模板中已停用` });

        const job = jobs.createJob(`rerun:${node.id}`, project.id, [node.id]);
        sendJson(res, 202, { success: true, jobId: job.id, job });
        runJob({ project, template, stage: node.stage, onlyNodeId: node.id, job, label: `重跑 ${node.id}` });
    });

    // 保存工作流编排：顺序 / 增删 / 启停 / 参数（工作流编辑器的拖拽排序与增删节点）
    router.post('/api/projects/:id/workflow/nodes', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const body = await readJsonBody(req);
        if (!Array.isArray(body.nodes)) return sendJson(res, 400, { success: false, message: '缺少 nodes 数组' });

        const template = workflow.getTemplate(project.workflow?.templateId || config.workflow.defaultTemplate);
        const currentById = new Map(workflow.projectEntries(project, template).map(entry => [entry.id, entry]));
        const libraryIds = new Set(workflow.describeLibrary().map(item => item.id));

        const seen = new Set();
        const entries = [];
        for (const item of body.nodes) {
            const id = String(item?.id || '');
            if (!libraryIds.has(id) || seen.has(id)) continue;
            seen.add(id);
            const previous = currentById.get(id) || {};
            entries.push({
                id,
                stage: previous.stage,
                enabled: item.enabled !== undefined ? Boolean(item.enabled) : previous.enabled,
                params: item.params !== undefined ? item.params : previous.params
            });
        }
        if (!entries.length) return sendJson(res, 400, { success: false, message: '工作流至少要保留一个节点' });

        const nodes = workflow.resolveNodes(template, project.workflow?.overrides || {}, entries);
        project.workflow = project.workflow || { templateId: template.id, overrides: {} };
        project.workflow.templateName = project.workflow.templateName || template.name;
        project.workflow.nodes = nodes.map(workflow.nodeSnapshot);
        storage.saveProject(project);

        sendJson(res, 200, {
            success: true,
            nodes: project.workflow.nodes,
            validation: workflow.validateChain(nodes, project)
        });
    });

    // 更新节点参数 / 启停（工作流编辑器与提示词槽位选择共用）
    router.post('/api/projects/:id/nodes/:nodeId/params', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const body = await readJsonBody(req);
        const { template, nodes } = resolveProjectNodes(project);
        const node = nodes.find(item => item.id === params.nodeId);
        if (!node) return sendJson(res, 404, { success: false, message: `节点 ${params.nodeId} 不在当前工作流里` });

        if (body.params) node.params = mergeParams(node.params, body.params);
        if (body.enabled !== undefined) node.enabled = Boolean(body.enabled);

        // 节点编排就是项目的事实来源：整条链一起落盘，刷新后启停/参数不会回退
        project.workflow = project.workflow || { templateId: template.id, overrides: {} };
        project.workflow.templateName = project.workflow.templateName || template.name;
        project.workflow.nodes = nodes.map(workflow.nodeSnapshot);
        storage.saveProject(project);

        sendJson(res, 200, {
            success: true,
            node: { id: node.id, label: node.label, enabled: node.enabled, params: node.params }
        });
    });

    // 更新单个镜头：槽位覆盖 / 字幕 / 运镜 / 画面描述
    // 变体选择：选定方向后写回项目，渲染链会跳过闸门继续
    // 角色参考图：从相册挑图绑定到项目，i2v 阶段作为 media[] 多图参考（提升一致性）
    router.post('/api/projects/:id/refs', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const body = await readJsonBody(req);
        const ids = Array.isArray(body.photoIds) ? body.photoIds.slice(0, 3) : [];
        const refs = [];
        for (const album of gallery.listAlbums()) {
            for (const photo of gallery.photosOf(album.id)) {
                if (ids.includes(photo.id)) refs.push({ photoId: photo.id, albumId: album.id, path: photo.file });
            }
        }
        project.characterRefs = refs;
        storage.saveProject(project);
        sendJson(res, 200, { success: true, characterRefs: refs });
    });

    router.post('/api/projects/:id/selection', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const body = await readJsonBody(req);
        const variantId = String(body.variantId || '').trim();
        if (!variantId) return sendJson(res, 400, { success: false, message: '缺少 variantId' });
        if (!(project.variants || []).some(item => item.id === variantId)) {
            return sendJson(res, 404, { success: false, message: `方向 ${variantId} 不存在` });
        }
        project.selectedVariant = variantId;
        // 把选定方向的关键帧提升为正式关键帧，精修阶段直接用它 + 角色参考图。
        // 注意：变体本身就是关键帧，不能只在「已有槽位」上覆盖——草稿筛选模板里
        // 没有 keyframe 节点，槽位本来是空数组，那样会得到一个空的关键帧列表。
        const selected = project.variants.find(item => item.id === variantId);
        const existing = new Map((project.assets.keyframes || []).map(item => [item.shot_id, item]));
        // 关键帧顺序必须和 project.shots 对齐：合成/ i2v 都是按索引取图的
        const byShot = new Map((selected.shots || []).map(item => [item.shot_id, item]));
        const order = (project.shots || []).length
            ? project.shots.map(shot => shot.shot_id)
            : [...byShot.keys()];
        project.assets.keyframes = order.filter(shotId => byShot.has(shotId)).map(shotId => {
            const slot = existing.get(shotId) || {};
            return { ...slot, shot_id: shotId, path: byShot.get(shotId).path, source: `variant:${variantId}` };
        });
        project.status = project.status === 'awaiting_selection' ? 'storyboard_ready' : project.status;
        storage.saveProject(project);
        sendJson(res, 200, { success: true, selectedVariant: variantId, keyframes: project.assets.keyframes });
    });

    // 一致性打分：每个镜头的关键帧与角色参考图比对，找出"跑样"的镜头
    router.post('/api/projects/:id/consistency-check', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const refs = project.characterRefs || [];
        if (!refs.length) return sendJson(res, 400, { success: false, message: '还没有绑定角色参考图' });

        let body = {};
        try {
            body = await readJsonBody(req);
        } catch (error) {
            body = {};
        }
        const threshold = Number(body.threshold) > 0 ? Number(body.threshold) : 6;
        const keyframes = (project.assets?.keyframes || []).filter(item => item?.path);
        const queue = keyframes.slice(0, Number(body.limit) > 0 ? Number(body.limit) : 10);
        if (!queue.length) return sendJson(res, 400, { success: false, message: '还没有关键帧可检查' });

        const results = [];
        const pending = [...queue];
        await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
            while (pending.length) {
                const item = pending.shift();
                try {
                    let best = { score: -1, diff: '' };
                    for (const ref of refs.slice(0, 2)) {
                        const verdict = await vision.compareImages({ imagePath: item.path, referencePath: ref.path });
                        if (verdict.score > best.score) best = verdict;
                    }
                    results.push({ shot_id: item.shot_id, path: item.path, thumb: item.thumb, ...best, ok: best.score >= threshold });
                } catch (error) {
                    results.push({ shot_id: item.shot_id, path: item.path, thumb: item.thumb, score: 0, diff: error.message, ok: false });
                }
            }
        }));
        results.sort((a, b) => a.score - b.score);
        sendJson(res, 200, {
            success: true,
            threshold,
            results,
            suspects: results.filter(item => !item.ok).map(item => item.shot_id)
        });
    });

    router.post('/api/projects/:id/shots/:shotId', async ({ req, res, params }) => {
        const project = storage.getProject(params.id);
        if (!project) return sendJson(res, 404, { success: false, message: '项目不存在' });
        const shot = (project.shots || []).find(item => item.shot_id === params.shotId);
        if (!shot) return sendJson(res, 404, { success: false, message: '镜头不存在' });

        const body = await readJsonBody(req);
        if (body.prompt_slots && typeof body.prompt_slots === 'object') {
            shot.prompt_slots = { ...(shot.prompt_slots || {}), ...body.prompt_slots };
        }
        if (body.reset_slots) shot.prompt_slots = null;
        if (body.caption !== undefined) {
            shot.caption = String(body.caption);
            shot.dialogue = String(body.caption);
        }
        if (body.camera !== undefined) shot.camera = String(body.camera);
        if (body.visual_desc !== undefined) shot.visual_desc = String(body.visual_desc);

        storage.saveProject(project);
        sendJson(res, 200, { success: true, shot });
    });

    // ---------------- 任务与文件 ----------------
    router.get('/api/jobs', async ({ res, query }) => {
        sendJson(res, 200, { success: true, jobs: jobs.listJobs(query.get('projectId')) });
    });

    router.get('/api/jobs/:id', async ({ res, params }) => {
        const job = jobs.getJob(params.id);
        if (!job) return sendJson(res, 404, { success: false, message: '任务不存在' });
        sendJson(res, 200, { success: true, job });
    });

    router.get('/api/files', async ({ req, res, query }) => {
        const target = query.get('path');
        if (!target) return sendJson(res, 400, { success: false, message: '缺少 path 参数' });
        let filePath;
        try {
            filePath = storage.resolveOutputFile(target);
        } catch (error) {
            return sendJson(res, 403, { success: false, message: error.message });
        }
        return sendFile(req, res, filePath, { download: query.get('download') === '1' });
    });
}

module.exports = { registerRoutes, summarizeProject, modelsSnapshot };
