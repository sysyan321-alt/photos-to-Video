'use strict';

const fs = require('fs');
const { createLogger } = require('../logger');
const NODE_LIBRARY = require('./nodes');
const pricing = require('../domain/pricing');

const log = createLogger('workflow');

/**
 * 项目的节点编排：顺序、增删、启停、参数都记在 project.workflow.nodes 里；
 * 项目还没有自己的编排时（老项目 / 刚立项）退回模板默认。
 */
function projectEntries(project, template) {
    const stored = project?.workflow?.nodes;
    if (Array.isArray(stored) && stored.length) return stored;
    return template.nodes || [];
}

/** 节点快照：项目里存的就是这一份（供前端渲染 + 下次运行复用） */
function nodeSnapshot(node) {
    return {
        id: node.id,
        label: node.label,
        stage: node.stage,
        enabled: node.enabled,
        requires: node.requires,
        produces: node.produces,
        providerKind: node.providerKind,
        params: node.params
    };
}

/** 节点库清单：工作流编辑器「添加节点」时从这里挑 */
function describeLibrary() {
    return Object.values(NODE_LIBRARY).map(impl => ({
        id: impl.id,
        label: impl.label,
        stage: impl.stage,
        enabled: impl.defaultEnabled !== false,
        requires: impl.requires || [],
        produces: impl.produces || [],
        providerKind: impl.providerKind || null,
        params: impl.params || {}
    }));
}

/**
 * 编排 + 项目覆盖 → 可执行节点列表。
 * enabled/params 三级合并：节点实现默认值 → 编排项 → 项目覆盖（overrides 优先，兼容旧的单点改写）。
 */
function resolveNodes(template, overrides = {}, entries = null) {
    return (entries || template.nodes || []).map(entry => {
        const impl = NODE_LIBRARY[entry.id];
        if (!impl) throw new Error(`模板引用了未知节点: ${entry.id}`);
        const override = overrides[entry.id] || {};
        const enabled = override.enabled !== undefined
            ? Boolean(override.enabled)
            : entry.enabled !== undefined ? Boolean(entry.enabled) : impl.defaultEnabled !== false;
        return {
            id: entry.id,
            label: impl.label,
            stage: entry.stage || impl.stage,
            requires: impl.requires || [],
            produces: impl.produces || [],
            providerKind: impl.providerKind || null,
            impl,
            enabled,
            params: { ...(impl.params || {}), ...(entry.params || {}), ...(override.params || {}) }
        };
    });
}

/** 任务面板用的步骤名：只列出该阶段真正会跑的节点 */
function stepsForStage(nodes, stage) {
    return nodes.filter(node => node.stage === stage && node.enabled).map(node => node.id);
}

/**
 * 产物可用性：项目里已经存在的东西也算数（例如外部传入完整 Brief 时，
 * brief 节点可以停用，但它的产物是有的）。
 */
function availableArtifacts(project) {
    const set = new Set();
    if (project.brief?.genre) set.add('brief');
    if (project.script) set.add('script');
    if (project.shots?.length) set.add('shots');
    if (project.shots?.some(shot => shot.keyframe_prompt)) set.add('prompt@shot');
    if (project.shots?.some(shot => shot.image_source)) set.add('image_source@shot');
    if ((project.assets?.keyframes || []).some(item => item?.path && fs.existsSync(item.path))) set.add('keyframe@shot');
    if (project.assets?.clips?.length) set.add('clip@shot');
    if (project.assets?.audio) set.add('audio');
    if (project.outputs?.video) set.add('video');
    if (project.publishPack) set.add('publish_pack');
    return set;
}

function missingRequirements(node, available) {
    return (node.requires || [])
        .filter(requirement => {
            const group = Array.isArray(requirement) ? requirement : [requirement];
            return !group.some(item => available.has(item));
        })
        .map(requirement => (Array.isArray(requirement) ? requirement.join(' 或 ') : requirement));
}

/** 契约校验：按「产物是否可得」推演一遍，上游被删/被停用且产物不存在时拦下来 */
function validateChain(nodes, project = null) {
    const problems = [];
    const available = project ? availableArtifacts(project) : new Set();
    for (const node of nodes) {
        if (!node.enabled) continue;
        const missing = missingRequirements(node, available);
        if (missing.length) {
            problems.push(`节点「${node.label}」需要 ${missing.join('、')} 的产物，但上游没有产出（节点被删除/停用，项目里也不存在）`);
            continue;
        }
        for (const artifact of node.produces || []) available.add(artifact);
    }
    return { ok: problems.length === 0, problems };
}

function applyResult(run, result) {
    run.detail = result.detail || null;
    run.degraded = Boolean(result.degraded);
    run.warnings = result.warnings || [];
    run.cost = result.cost || null;
    run.status = run.degraded ? 'degraded' : 'succeeded';
    run.finishedAt = new Date().toISOString();
    run.paused = Boolean(result.pause);
}

function syncWorkflowMeta(project, template, nodes) {
    project.workflow = {
        // 保留 overrides 等既有字段，否则每次运行都会把项目改动冲掉
        ...(project.workflow || {}),
        templateId: template.id,
        templateName: template.name,
        // 带上契约元数据，前端工作流编辑器才能离线推演「上游产物是否齐备」
        nodes: nodes.map(nodeSnapshot)
    };
    project.nodeRuns = project.nodeRuns || [];
}

/**
 * 执行工作流的一个阶段。
 * stage: 'pre'（立项阶段：创意/剧本/分镜/提示词）| 'render'（渲染阶段：关键帧/视频/音频/合成）
 * onlyNodeId: 只重跑单个节点（复用上游已有产物）
 */
async function runStage({ project, template, stage, onlyNodeId = null, config, providers, storage, job = null, jobs = null }) {
    const nodes = resolveNodes(template, project.workflow?.overrides || {}, projectEntries(project, template));
    const validation = validateChain(nodes, project);
    if (!validation.ok && !onlyNodeId) {
        throw new Error(`工作流校验失败：${validation.problems.join('；')}`);
    }

    syncWorkflowMeta(project, template, nodes);
    const dirs = storage.ensureProjectDirs(project.id);
    const targets = nodes.filter(node => (onlyNodeId ? node.id === onlyNodeId : node.stage === stage));
    const executed = [];

    for (const node of targets) {
        const run = {
            nodeId: node.id,
            label: node.label,
            stage: node.stage,
            status: 'pending',
            startedAt: null,
            finishedAt: null,
            detail: null,
            degraded: false,
            warnings: [],
            cost: null
        };
        project.nodeRuns = project.nodeRuns.filter(item => item.nodeId !== node.id).concat(run);

        if (!node.enabled) {
            run.status = 'skipped';
            run.detail = '模板中已停用';
            run.finishedAt = new Date().toISOString();
            storage.saveProject(project);
            if (job && jobs) jobs.appendLog(job, `跳过「${node.label}」（已停用）`);
            continue;
        }

        run.status = 'running';
        run.startedAt = new Date().toISOString();
        storage.saveProject(project);
        if (job && jobs) {
            jobs.startStep(job, node.id);
            jobs.appendLog(job, `▶ ${node.label}`);
        }

        const ctx = {
            project,
            config,
            video: config.video,
            providers,
            storage,
            dirs,
            job,
            jobs,
            params: node.params,
            log(message) {
                log.info(`[${project.id}/${node.id}] ${message}`);
                if (job && jobs) jobs.appendLog(job, message);
            }
        };

        try {
            // 预算护栏：付费节点在调用前估算，超预算直接中止（不产生费用）
            if (node.providerKind) {
                const nextYuan = pricing.estimatePaidCall(node.providerKind, {
                    model: providers.get(node.providerKind)?.model,
                    seconds: Number(node.params?.duration) || 3
                });
                const verdict = pricing.checkBudget({
                    spentYuan: Number(project.spend?.yuan) || 0,
                    nextYuan
                });
                if (!verdict.ok) throw new Error(verdict.reason);
            }
            const missing = missingRequirements(node, availableArtifacts(project));
            if (missing.length) throw new Error(`缺少上游产物：${missing.join('、')}`);
            if (node.providerKind) {
                const provider = providers.get(node.providerKind);
                const check = provider?.canRun ? provider.canRun() : { ok: true };
                if (check.ok === false) ctx.log(`provider 未就绪：${check.reason}`);
            }
            if (node.impl.canRun) {
                const check = await node.impl.canRun(ctx);
                if (check && check.ok === false) throw new Error(check.reason || '前置条件不满足');
            }
            if (typeof node.impl.run !== 'function') throw new Error('该节点尚未实现');

            applyResult(run, (await node.impl.run(ctx)) || {});
            project.spend = pricing.accumulate(project.spend, run.cost);
            storage.saveProject(project);
            if (job && jobs) jobs.finishStep(job, node.id, run.detail);
            executed.push({ node, run });
            // 人工闸门：干净地停下整条链（不是失败），等用户选定方向
            if (run.paused) {
                if (job && jobs) jobs.setStatus(job, 'awaiting_selection');
                return { nodes, executed, paused: true };
            }
        } catch (error) {
            const failedRun = run;
            if (typeof node.impl.fallback === 'function') {
                try {
                    ctx.log(`节点「${node.label}」失败，执行降级：${error.message}`);
                    applyResult(failedRun, { ...(await node.impl.fallback(ctx)), degraded: true });
                    storage.saveProject(project);
                    if (job && jobs) jobs.finishStep(job, node.id, `${failedRun.detail}（降级）`);
                    executed.push({ node, run: failedRun });
                    continue;
                } catch (fallbackError) {
                    failedRun.status = 'failed';
                    failedRun.detail = `${error.message}；降级也失败：${fallbackError.message}`;
                    failedRun.finishedAt = new Date().toISOString();
                    storage.saveProject(project);
                    if (job && jobs) jobs.failStep(job, node.id, failedRun.detail);
                    throw new Error(`节点「${node.label}」失败：${failedRun.detail}`);
                }
            }
            failedRun.status = 'failed';
            failedRun.detail = error.message;
            failedRun.finishedAt = new Date().toISOString();
            storage.saveProject(project);
            if (job && jobs) jobs.failStep(job, node.id, error.message);
            throw new Error(`节点「${node.label}」失败：${error.message}`);
        }
    }

    return { nodes, executed };
}

module.exports = {
    resolveNodes,
    projectEntries,
    nodeSnapshot,
    describeLibrary,
    stepsForStage,
    validateChain,
    availableArtifacts,
    missingRequirements,
    runStage,
    NODE_LIBRARY
};
