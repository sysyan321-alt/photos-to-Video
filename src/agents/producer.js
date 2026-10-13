'use strict';

const { createLogger } = require('../logger');
const { createProject } = require('../domain/project');
const { normalizeBrief } = require('../domain/brief');
const workflow = require('../workflow');

const log = createLogger('producer');

/**
 * 总控 Agent：立项 + 调度「前期」节点链。
 * 节点顺序来自工作流模板（可自定义），不再硬编码在 Agent 里。
 */
async function runPreproduction({ idea, title, brief: incomingBrief, projectId, templateId, config, providers, storage, job = null, jobs = null }) {
    const existing = projectId ? storage.getProject(projectId) : null;
    const targetId = existing?.id || storage.newProjectId();
    const template = workflow.getTemplate(templateId || existing?.workflow?.templateId || config.workflow?.defaultTemplate);
    if (!template) throw new Error(`工作流模板不存在: ${templateId}`);

    // 给了完整 Brief（人工确认/编辑过）就停用 brief 节点，避免把它覆盖掉；
    // 只给一句话创意时，brief 节点会在链路里现算。
    const seed = incomingBrief
        ? normalizeBrief({ ...incomingBrief, raw: incomingBrief.raw || idea }, { video: config.video })
        : normalizeBrief({ raw: idea, title: title || '' }, { video: config.video });
    const isFullBrief = Boolean(incomingBrief && incomingBrief.genre && incomingBrief.title);
    const overrides = isFullBrief ? { brief: { enabled: false } } : {};

    let project = existing;
    if (!project) {
        project = createProject({ id: targetId, idea: seed.raw || idea || '', title: title || '', video: config.video, style: null });
        project.brief = seed;
        project.workflow = { templateId: template.id, overrides };
        storage.saveProject(project);
    } else {
        project.initialIdea = idea || project.initialIdea;
        project.brief = seed;
        project.workflow = { ...(project.workflow || {}), templateId: template.id, overrides };
        // 镜头会重算，旧的素材与成片链接作废
        project.assets = { keyframes: [], clips: [], shotVideos: {}, audio: null };
        project.outputs = {};
        project.nodeRuns = [];
        project.status = 'draft';
        project.updatedAt = new Date().toISOString();
        delete project.completedAt;
        storage.saveProject(project);
    }

    if (isFullBrief) storage.saveBrief(seed);
    const dirs = storage.ensureProjectDirs(targetId);

    await workflow.runStage({ project, template, stage: 'pre', config, providers, storage, job, jobs });

    if (project.brief?.id) {
        storage.saveBrief(project.brief);
        storage.writeJson(dirs.briefFile, project.brief);
    }
    project.status = 'storyboard_ready';
    storage.saveProject(project);

    log.info(`项目 ${targetId} 前期完成：${project.shots.length} 个镜头 / 模板 ${template.id}${existing ? '（重生成）' : ''}`);
    return project;
}

module.exports = { runPreproduction };
