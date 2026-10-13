// 全局状态 + 业务动作（相当于一个极简 store，避免为了 MVP 引入 Pinia）

import { reactive } from '/vendor/vue.esm-browser.prod.js';
import { api, copyText, downloadText } from './api.js';

const DRAFT_KEY = 'comicdramaDraft';
const SELECTION_KEY = 'comicdramaSelection';
const PROMPTS_KEY = 'comicdramaPrompts';

function readLocal(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

export const state = reactive({
    view: 'home',
    albums: [],
    currentAlbum: null,
    photos: [],
    allPhotos: [],
    batch: null,
    ranking: [],
    recommend: [],
    upload: { busy: false, done: 0, total: 0 },
    health: null,
    projects: [],
    project: null,
    workflowTemplate: null,
    nodeLibrary: [],
    templates: [],
    defaultTemplate: '',
    tab: 'brief',
    job: null,
    pollTimer: null,
    selected: {},
    selectionCache: readLocal(SELECTION_KEY, {}),
    prompts: readLocal(PROMPTS_KEY, []),
    presets: { presets: [], groups: [], slotLabels: {}, slotOrder: [] },
    presetEditing: null,
    create: { open: false, idea: '', brief: null, templateId: '' },
    preview: { open: false, shot: null },
    promptsOpen: false,
    loading: { visible: false, text: '' },
    toast: { visible: false, text: '', type: 'success' }
});

let toastTimer = null;

export function notify(text, type = 'success') {
    state.toast = { visible: true, text, type };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.toast.visible = false; }, 2600);
}

function setLoading(visible, text = '处理中…') {
    state.loading = { visible, text };
}

function persistSelection() {
    if (!state.project) return;
    state.selectionCache[state.project.id] = { ...state.selected };
    localStorage.setItem(SELECTION_KEY, JSON.stringify(state.selectionCache));
}

function persistPrompts() {
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(state.prompts));
}

/** 项目里的节点快照数组：老项目可能缺失或为 null，这里兜底成可写数组 */
function workflowNodes() {
    if (!state.project) return [];
    state.project.workflow = state.project.workflow || { overrides: {} };
    if (!Array.isArray(state.project.workflow.nodes)) state.project.workflow.nodes = [];
    return state.project.workflow.nodes;
}

export const actions = {
    // ---------- 初始化 ----------
    async loadHealth() {
        try {
            const data = await api('/api/health');
            state.health = data;
        } catch (error) {
            state.health = { error: error.message };
        }
    },

    async loadProjects() {
        try {
            const { projects } = await api('/api/projects');
            state.projects = projects;
        } catch (error) {
            notify(`项目列表加载失败: ${error.message}`, 'error');
        }
    },

    async openProject(id) {
        const { project } = await api(`/api/projects/${id}`);
        state.project = project;
        state.view = 'workspace';
        state.tab = 'brief';
        state.selected = { ...(state.selectionCache[id] || {}) };
        state.job = null;
        // 工作流面板要用模板描述与节点库里的 requires / produces / providerKind 做契约推演
        this.loadWorkflowTemplate(project.workflow?.templateId);
        if (!state.nodeLibrary.length) this.loadNodeLibrary();
        // 深链：刷新或分享链接都能直接回到同一个项目
        if (!location.hash.includes(id)) location.hash = `#/p/${id}`;
        window.scrollTo({ top: 0 });
    },

    backToHome() {
        state.view = 'home';
        state.project = null;
        state.job = null;
        clearInterval(state.pollTimer);
        history.replaceState(null, '', location.pathname);
        this.loadProjects();
    },

    /** 启动时按 URL 里的项目 ID 恢复工作区 */
    async restoreFromHash() {
        const match = /^#\/p\/([\w-]+)$/.exec(location.hash || '');
        if (!match) return;
        try {
            await this.openProject(match[1]);
        } catch (error) {
            history.replaceState(null, '', location.pathname);
        }
    },

    // ---------- 创意模块 ----------
    openCreateModal() {
        const draft = readLocal(DRAFT_KEY, null);
        const picked = state.create.templateId;
        const valid = picked && state.templates.some(item => item.id === picked);
        state.create = {
            open: true,
            idea: draft?.idea || '',
            brief: draft?.brief || null,
            templateId: valid ? picked : (state.defaultTemplate || state.templates[0]?.id || '')
        };
        if (!state.templates.length) this.loadTemplates();
    },

    closeCreateModal() {
        state.create.open = false;
    },

    async analyzeIdea(idea) {
        const text = String(idea || state.create.idea || '').trim();
        if (!text) return notify('请先写一句创意', 'error');
        setLoading(true, '创意 Agent 正在解析…');
        try {
            const { brief } = await api('/api/ideas', {
                method: 'POST',
                body: JSON.stringify({ idea: text })
            });
            state.create.brief = brief;
            this.saveDraft(false);
            notify(`Brief 已生成：${brief.genre} / ${brief.title}`);
        } catch (error) {
            notify(`解析失败: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    },

    async createProject() {
        const idea = String(state.create.idea || '').trim();
        const brief = state.create.brief && state.create.brief.raw === idea ? state.create.brief : null;
        if (!idea && !brief) return notify('请先写一句创意', 'error');
        setLoading(true, '总控 Agent 正在编排剧本与分镜…');
        try {
            const { project } = await api('/api/projects', {
                method: 'POST',
                body: JSON.stringify({
                    ...(brief ? { brief } : { idea }),
                    templateId: state.create.templateId || undefined
                })
            });
            state.create.open = false;
            await this.loadProjects();
            await this.openProject(project.id);
            notify('剧本与分镜已生成');
        } catch (error) {
            notify(`创建失败: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    },

    async saveBriefEdits(brief) {
        try {
            const { brief: saved } = await api(`/api/ideas/${brief.id}`, {
                method: 'POST',
                body: JSON.stringify(brief)
            });
            state.project.brief = saved;
            notify('Brief 已保存');
        } catch (error) {
            notify(`保存失败: ${error.message}`, 'error');
        }
    },

    async regeneratePreproduction() {
        if (!window.confirm('将按当前 Brief 重新生成剧本与分镜，旧的分镜素材与成片链接会作废，但项目 ID 和创意保留。继续？')) {
            return;
        }
        setLoading(true, '编剧与分镜 Agent 重新生成中…');
        try {
            const { project } = await api(`/api/projects/${state.project.id}/preproduction`, {
                method: 'POST',
                body: JSON.stringify({ brief: state.project.brief })
            });
            state.project = project;
            state.tab = 'shots';
            notify('已按 Brief 重新生成');
        } catch (error) {
            notify(`重新生成失败: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    },

    // ---------- 渲染 ----------
    async startRender() {
        if (!state.project) return;
        setLoading(true, '渲染任务已提交…');
        try {
            const { job } = await api(`/api/projects/${state.project.id}/render`, { method: 'POST' });
            state.job = job;
            state.tab = 'render';
            this.pollJob(job.id);
            notify('渲染已开始');
        } catch (error) {
            notify(`无法启动渲染: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    },

    pollJob(jobId) {
        clearInterval(state.pollTimer);
        state.pollTimer = setInterval(async () => {
            try {
                const { job } = await api(`/api/jobs/${jobId}`);
                state.job = job;
                if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'awaiting_selection') {
                    clearInterval(state.pollTimer);
                    if (job.status === 'succeeded') {
                        const { project } = await api(`/api/projects/${state.project.id}`);
                        state.project = project;
                        notify('成片已生成');
                    } else if (job.status === 'awaiting_selection') {
                        // 人工闸门：去「方向对比」选定一个方向，再回来点渲染
                        await this.reloadProject();
                        state.tab = 'variants';
                        notify('已生成变体，请在「方向对比」里选定一个方向');
                    } else {
                        notify(`渲染失败: ${job.error || '未知错误'}`, 'error');
                    }
                    this.loadProjects();
                }
            } catch (error) {
                clearInterval(state.pollTimer);
            }
        }, 1500);
    },

    /** 选定变体方向：该方向的关键帧被提升为正式关键帧，渲染时走 i2v 精修 */
    async selectVariant(variantId) {
        try {
            const data = await api(`/api/projects/${state.project.id}/selection`, {
                method: 'POST',
                body: JSON.stringify({ variantId })
            });
            await this.reloadProject();
            notify(`已选定方向：${data.selectedVariant}，点「渲染」继续精修`);
        } catch (error) {
            notify(`选定失败: ${error.message}`, 'error');
        }
    },

    async deleteProject(id, name) {
        if (!window.confirm(`删除项目「${name}」及其全部产物（关键帧、片段、成片）？此操作不可恢复。`)) return;
        try {
            await api(`/api/projects/${id}`, { method: 'DELETE' });
            notify('项目已删除');
            await this.loadProjects();
        } catch (error) {
            notify(`删除失败: ${error.message}`, 'error');
        }
    },

    // ---------- 勾选 / 复制 / 导出 ----------
    toggleShot(shotId, checked) {
        if (checked) state.selected[shotId] = true;
        else delete state.selected[shotId];
        persistSelection();
    },

    toggleAllShots(checked) {
        if (!state.project) return;
        state.selected = {};
        if (checked) {
            for (const shot of state.project.shots) state.selected[shot.shot_id] = true;
        }
        persistSelection();
    },

    clearSelection() {
        state.selected = {};
        persistSelection();
    },

    notify,
    copy: (text, message) => copyText(text, message, notify),
    download: downloadText,

    // ---------- 提示词库 ----------
    async loadPresets() {
        try {
            const data = await api('/api/presets');
            state.presets = {
                presets: data.presets,
                groups: data.groups,
                slotLabels: data.slotLabels,
                slotOrder: data.slotOrder
            };
        } catch (error) {
            notify(`提示词库加载失败: ${error.message}`, 'error');
        }
    },

    async createPreset(payload) {
        try {
            const data = await api('/api/presets', { method: 'POST', body: JSON.stringify(payload) });
            await this.loadPresets();
            notify(`预设已保存：${data.preset.name}`);
            return true;
        } catch (error) {
            notify(`保存失败: ${error.message}`, 'error');
            return false;
        }
    },

    async updatePreset(id, payload) {
        try {
            await api(`/api/presets/${id}`, { method: 'POST', body: JSON.stringify(payload) });
            await this.loadPresets();
            notify('预设已更新');
            return true;
        } catch (error) {
            notify(`更新失败: ${error.message}`, 'error');
            return false;
        }
    },

    async deletePreset(id) {
        if (!window.confirm(`删除预设 ${id}？`)) return;
        try {
            await api(`/api/presets/${id}`, { method: 'DELETE' });
            await this.loadPresets();
            notify('预设已删除');
        } catch (error) {
            notify(`删除失败: ${error.message}`, 'error');
        }
    },

    async exportPresets() {
        try {
            const data = await api('/api/presets/export');
            downloadText('comicdrama-presets.json', JSON.stringify(data, null, 2));
            notify(`已导出 ${data.presets.length} 条预设`);
        } catch (error) {
            notify(`导出失败: ${error.message}`, 'error');
        }
    },

    async importPresets(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            return notify('导入内容不是合法 JSON', 'error');
        }
        try {
            const data = await api('/api/presets/import', {
                method: 'POST',
                body: JSON.stringify({ presets: parsed.presets || parsed })
            });
            await this.loadPresets();
            notify(`导入完成：新增 ${data.added} 条，共 ${data.total} 条`);
        } catch (error) {
            notify(`导入失败: ${error.message}`, 'error');
        }
    },

    // ---------- 工作流节点参数 / 单镜头编辑 ----------
    /** 工作流模板清单（内置 + 自定义），建项目时可选 */
    async loadTemplates() {
        try {
            const data = await api('/api/workflows');
            state.templates = data.templates || [];
            state.defaultTemplate = data.defaultTemplate || '';
        } catch (error) {
            notify(`模板列表加载失败: ${error.message}`, 'error');
        }
    },

    /** 删除自定义模板 */
    async deleteTemplate(id) {
        try {
            const data = await api(`/api/workflows/${id}`, { method: 'DELETE' });
            await this.loadTemplates();
            if (state.create.templateId === id) state.create.templateId = state.defaultTemplate || state.templates[0]?.id || '';
            notify(data.message || '模板已删除');
        } catch (error) {
            notify(`删除失败: ${error.message}`, 'error');
        }
    },

    /** 重命名自定义模板 */
    async renameTemplate(id, name) {
        try {
            await api(`/api/workflows/${id}`, { method: 'POST', body: JSON.stringify({ name }) });
            await this.loadTemplates();
            notify(`模板已重命名为「${name}」`);
            return true;
        } catch (error) {
            notify(`重命名失败: ${error.message}`, 'error');
            return false;
        }
    },

    /** 节点库清单（「添加节点」的可选项） */
    async loadNodeLibrary() {
        try {
            const data = await api('/api/workflow/nodes');
            state.nodeLibrary = data.nodes || [];
        } catch (error) {
            state.nodeLibrary = [];
        }
    },

    /** 保存整条编排（顺序 / 增删 / 启停）：工作流编辑器的拖拽与增删节点都走这里 */
    async saveWorkflowNodes(list) {
        try {
            const { nodes } = await api(`/api/projects/${state.project.id}/workflow/nodes`, {
                method: 'POST',
                body: JSON.stringify({ nodes: list.map(node => ({ id: node.id, enabled: node.enabled, params: node.params })) })
            });
            state.project.workflow = { ...(state.project.workflow || {}), nodes };
            notify('工作流编排已保存');
            return true;
        } catch (error) {
            notify(`编排保存失败: ${error.message}`, 'error');
            return false;
        }
    },

    /** 拉取模板描述（含每个节点的 requires/produces/providerKind），供工作流面板做契约推演 */
    async loadWorkflowTemplate(templateId) {
        if (!templateId) {
            state.workflowTemplate = null;
            return;
        }
        try {
            const { template } = await api(`/api/workflows/${templateId}`);
            state.workflowTemplate = template;
        } catch (error) {
            state.workflowTemplate = null;
        }
    },

    promptNode() {
        return (state.project?.workflow?.nodes || []).find(node => node.id === 'prompt_assembly') || null;
    },

    async setNodeParams(nodeId, params, reload = false) {
        try {
            const data = await api(`/api/projects/${state.project.id}/nodes/${nodeId}/params`, {
                method: 'POST',
                body: JSON.stringify({ params })
            });
            const list = workflowNodes();
            let local = list.find(node => node.id === nodeId);
            if (!local) {
                local = { id: nodeId };
                list.push(local);
            }
            local.params = data.node.params;
            local.enabled = data.node.enabled;
            if (reload) await this.reloadProject();
            notify('节点参数已保存');
            return true;
        } catch (error) {
            notify(`保存失败: ${error.message}`, 'error');
            return false;
        }
    },

    /** 切换节点启停（工作流面板用） */
    async setNodeEnabled(nodeId, enabled) {
        try {
            const data = await api(`/api/projects/${state.project.id}/nodes/${nodeId}/params`, {
                method: 'POST',
                body: JSON.stringify({ enabled })
            });
            const list = workflowNodes();
            let local = list.find(node => node.id === nodeId);
            if (!local) {
                local = { id: nodeId };
                list.push(local);
            }
            local.enabled = data.node.enabled;
            notify(`${nodeId} 已${enabled ? '启用' : '停用'}`);
        } catch (error) {
            notify(`切换失败: ${error.message}`, 'error');
        }
    },

    /** 把当前编排固化为可复用模板 */
    async saveTemplate(name) {
        try {
            const { template } = await api('/api/workflows', {
                method: 'POST',
                body: JSON.stringify({ projectId: state.project.id, name })
            });
            await this.loadTemplates();
            notify(`已存为模板：${template.name}`);
        } catch (error) {
            notify(`保存失败: ${error.message}`, 'error');
        }
    },

    async updateShot(shotId, patch) {
        try {
            const { shot } = await api(`/api/projects/${state.project.id}/shots/${shotId}`, {
                method: 'POST',
                body: JSON.stringify(patch)
            });
            const index = (state.project.shots || []).findIndex(item => item.shot_id === shotId);
            if (index >= 0) state.project.shots[index] = shot;
            notify('镜头已更新');
            return true;
        } catch (error) {
            notify(`更新失败: ${error.message}`, 'error');
            return false;
        }
    },

    async reloadProject() {
        if (!state.project) return;
        const { project } = await api(`/api/projects/${state.project.id}`);
        state.project = project;
    },

    async rerunNode(nodeId) {
        setLoading(true, `重跑节点 ${nodeId}…`);
        try {
            const { job } = await api(`/api/projects/${state.project.id}/nodes/${nodeId}/rerun`, { method: 'POST' });
            await new Promise(resolve => {
                const timer = setInterval(async () => {
                    const { job: latest } = await api(`/api/jobs/${job.id}`);
                    if (latest.status === 'succeeded' || latest.status === 'failed') {
                        clearInterval(timer);
                        resolve(latest);
                    }
                }, 1200);
            });
            await this.reloadProject();
            notify('节点已重跑');
        } catch (error) {
            notify(`重跑失败: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    },

    addPrompt(text) {
        const value = String(text || '').trim();
        if (!value) return notify('提示词为空', 'error');
        if (!state.prompts.includes(value)) state.prompts.unshift(value);
        state.prompts = state.prompts.slice(0, 100);
        persistPrompts();
        notify('已存入提示词库');
    },

    removePrompt(index) {
        state.prompts.splice(index, 1);
        persistPrompts();
    },

    // ---------- 草稿 ----------
    // ---------- 个人相册 ----------
    /** 智能选图：给相册里的图按目的打分排序（默认挑钩子镜头） */
    /** 相册 → 故事：用素材本身写剧本，可选直接立项 */
    /** 批量生产：一次投多条创意，返回批次；随后用 refreshBatch 轮询 */
    /** 数据闭环：回填投放数据 */
    /** 生成发布包（文案 + 带 AI 标识的打标成片） */
    /** 运行审核（合规 + 图文一致性） */
    /** 用相册照片作画面来源（关键帧 0 元） */
    /** 模型接入配置 */
    /** 打分任务：提交后立刻返回 jobId，用 refreshScoreJob 轮询进度，可取消 */
    async startScoreJob(albumId, purpose, onlyUnscored = true) {
        try {
            const data = await api(`/api/gallery/albums/${albumId}/score`, {
                method: 'POST',
                body: JSON.stringify({ purpose, onlyUnscored })
            });
            if (data.jobId) return { jobId: data.jobId, total: data.total };
            notify(data.message || '所有照片都已打分', 'success');
            return null;
        } catch (error) {
            notify(`启动打分失败: ${error.message}`, 'error');
            return null;
        }
    },

    async refreshScoreJob(jobId) {
        try {
            const { job } = await api(`/api/jobs/${jobId}`);
            return job;
        } catch (error) {
            return null;
        }
    },

    async cancelScoreJob(jobId) {
        try {
            await api(`/api/jobs/${jobId}/cancel`, { method: 'POST', body: '{}' });
            notify('已请求取消，当前这张完成后停止');
        } catch (error) {
            notify(`取消失败: ${error.message}`, 'error');
        }
    },

    async loadProviderConfig() {
        try {
            const data = await api('/api/config/providers');
            state.providerConfig = data.providers || [];
            return state.providerConfig;
        } catch (error) {
            notify(`读取模型配置失败: ${error.message}`, 'error');
            return [];
        }
    },

    async saveProvider(payload) {
        try {
            const data = await api('/api/config/providers', { method: 'POST', body: JSON.stringify(payload) });
            state.providerConfig = data.providers || [];
            await this.loadHealth();
            notify(`${payload.kind} 配置已保存并生效`);
            return true;
        } catch (error) {
            notify(`保存失败: ${error.message}`, 'error');
            return false;
        }
    },

    async testProvider(kind) {
        try {
            const data = await api(`/api/providers/${kind}/test`, { method: 'POST', body: '{}' });
            notify(data.result?.message || '测试完成', data.result?.ok === false ? 'error' : 'success');
            return data.result;
        } catch (error) {
            notify(`测试失败: ${error.message}`, 'error');
            return null;
        }
    },

    async useAlbum(albumId, pick = 'sequential') {
        setLoading(true, '正在把照片分配到镜头…');
        try {
            const data = await api(`/api/projects/${state.project.id}/use-album`, {
                method: 'POST',
                body: JSON.stringify({ albumId, pick })
            });
            await this.reloadProject();
            const assigned = (data.shots || []).filter(item => item.image_source === 'album').length;
            notify(`已把 ${assigned} 张照片分配到镜头（关键帧 0 元）`);
            return data;
        } catch (error) {
            notify(`应用失败: ${error.message}`, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    },

    async runReview() {
        setLoading(true, '正在审核…');
        try {
            const data = await api(`/api/projects/${state.project.id}/review`, { method: 'POST' });
            state.project.review = data.review;
            notify(`审核完成：${data.review.risk === 'low' ? '低风险' : data.review.risk === 'medium' ? '中风险' : '高风险'}`);
            return data.review;
        } catch (error) {
            notify(`审核失败: ${error.message}`, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    },

    async publishProject(platform) {
        setLoading(true, '正在生成发布包…');
        try {
            const data = await api(`/api/projects/${state.project.id}/publish`, {
                method: 'POST',
                body: JSON.stringify({ platform })
            });
            await this.reloadProject();
            notify(data.pack?.stampedVideo ? '发布包已生成（含打标成片）' : '发布包已生成');
            return data.pack;
        } catch (error) {
            notify(`生成失败: ${error.message}`, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    },

    async recordMetrics(projectId, metrics) {
        try {
            const data = await api(`/api/projects/${projectId}/metrics`, {
                method: 'POST',
                body: JSON.stringify(metrics)
            });
            notify(`已回填：得分 ${data.metrics.score}`);
            await this.loadProjects();
            return true;
        } catch (error) {
            notify(`回填失败: ${error.message}`, 'error');
            return false;
        }
    },

    /** 拉取预设效果排行与推荐 */
    async loadRanking(slot = 'style') {
        try {
            const ranking = await api(`/api/analytics/presets?slot=${encodeURIComponent(slot)}`);
            state.ranking = ranking.ranking || [];
            const recommend = await api(`/api/analytics/recommend?slot=${encodeURIComponent(slot)}&limit=3`);
            state.recommend = recommend.recommend || [];
        } catch (error) {
            state.ranking = [];
            state.recommend = [];
        }
    },

    /** 把推荐组合应用到项目提示词槽位（下次重新组装生效） */
    async applyPresetRecommendation(presetIds) {
        if (!state.project) {
            notify('请先打开一个项目，再应用推荐', 'error');
            return;
        }
        await this.setNodeParams('prompt_assembly', { slots: { style: presetIds } });
        notify('推荐已写入该项目的画风槽位，重新组装后生效');
    },

    async startBatch(ideas, templateId) {
        setLoading(true, '正在批量立项…');
        try {
            const data = await api('/api/batch', {
                method: 'POST',
                body: JSON.stringify({ ideas, templateId })
            });
            state.batch = { id: data.batchId, status: 'preparing', items: data.items, spendYuan: 0 };
            await this.loadProjects();
            notify(`批次已启动：${data.count} 条，串行渲染中`);
            return data;
        } catch (error) {
            notify(`批量启动失败: ${error.message}`, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    },

    /** 刷新批次状态；返回 true 表示已跑完 */
    async refreshBatch() {
        if (!state.batch?.id) return true;
        try {
            const { batch } = await api(`/api/batch/${state.batch.id}`);
            state.batch = batch;
            if (['done', 'failed'].includes(batch.status)) {
                await this.loadProjects();
                notify(`批次完成：${batch.items.filter(item => item.status === 'completed').length}/${batch.items.length} 成片，共 ${batch.spendYuan} 元`);
                return true;
            }
            return false;
        } catch (error) {
            return true;
        }
    },

    async albumStory(albumId, { shots = 5, createProject = false } = {}) {
        setLoading(true, createProject ? '正在写故事并立项…' : '正在读图写故事…');
        try {
            const data = await api(`/api/gallery/albums/${albumId}/story`, {
                method: 'POST',
                body: JSON.stringify({ shots, createProject })
            });
            if (data.project) {
                await this.loadProjects();
                await this.openProject(data.project.id);
                notify(`已按素材立项：${data.project.name}`);
            }
            return data;
        } catch (error) {
            notify(`写故事失败: ${error.message}`, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    },

    async pickBestPhotos(albumId, purpose = '竖屏短剧的钩子镜头', count = 3) {
        setLoading(true, '视觉模型正在打分…');
        try {
            const data = await api(`/api/gallery/albums/${albumId}/pick`, {
                method: 'POST',
                body: JSON.stringify({ count, purpose })
            });
            notify(`已按「${purpose}」排序 ${data.ranked.length} 张`);
            return data;
        } catch (error) {
            notify(`打分失败: ${error.message}`, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    },

    /** 一致性检查：比对关键帧与角色参考图，找出跑样的镜头 */
    async runConsistencyCheck(threshold = 6, limit = 10) {
        setLoading(true, '正在比对角色一致性…');
        try {
            const data = await api(`/api/projects/${state.project.id}/consistency-check`, {
                method: 'POST',
                body: JSON.stringify({ threshold, limit })
            });
            notify(data.suspects.length ? `发现 ${data.suspects.length} 个疑似跑样镜头` : '一致性检查通过');
            return data;
        } catch (error) {
            notify(`检查失败: ${error.message}`, 'error');
            return null;
        } finally {
            setLoading(false);
        }
    },

    /** 拉全部相册的照片，供「角色参考图」面板挑选 */
    async loadAllPhotos() {
        try {
            const { albums } = await api('/api/gallery/albums');
            const all = [];
            for (const album of albums) {
                const { photos } = await api(`/api/gallery/albums/${album.id}/photos`);
                for (const photo of photos) all.push({ ...photo, albumId: album.id });
            }
            state.allPhotos = all;
            return all;
        } catch (error) {
            notify(`照片加载失败: ${error.message}`, 'error');
            return [];
        }
    },

    /** 绑定角色参考图（最多 3 张），i2v 阶段作为多图参考 */
    /** 风格反推：用视觉模型从这张图提炼画风，直接存成 style 预设 */
    async reverseStyleFromPhoto(photoId) {
        setLoading(true, '正在反推风格…');
        try {
            const data = await api('/api/presets/from-image', {
                method: 'POST',
                body: JSON.stringify({ photoId })
            });
            await this.loadPresets();
            notify(`已存入提示词库：${data.preset.name}`);
            return data.preset;
        } catch (error) {
            notify(`反推失败: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    },

    async setCharacterRefs(photoIds) {
        try {
            const data = await api(`/api/projects/${state.project.id}/refs`, {
                method: 'POST',
                body: JSON.stringify({ photoIds })
            });
            state.project.characterRefs = data.characterRefs || [];
            notify(`已绑定 ${(data.characterRefs || []).length} 张参考图`);
        } catch (error) {
            notify(`绑定失败: ${error.message}`, 'error');
        }
    },

    async loadAlbums() {
        try {
            const { albums } = await api('/api/gallery/albums');
            state.albums = albums;
            if (state.currentAlbum) {
                state.currentAlbum = albums.find(album => album.id === state.currentAlbum.id) || null;
            }
        } catch (error) {
            notify(`相册加载失败: ${error.message}`, 'error');
        }
    },

    async createAlbum(name, description = '') {
        const value = String(name || '').trim();
        if (!value) return notify('请填写相册名称', 'error');
        try {
            const { album } = await api('/api/gallery/albums', {
                method: 'POST',
                body: JSON.stringify({ name: value, description })
            });
            await this.loadAlbums();
            await this.openAlbum(album.id);
            notify(`相册「${album.name}」已创建`);
        } catch (error) {
            notify(`创建失败: ${error.message}`, 'error');
        }
    },

    async openAlbum(albumId) {
        try {
            const album = state.albums.find(item => item.id === albumId) || { id: albumId, name: albumId };
            state.currentAlbum = album;
            const { photos } = await api(`/api/gallery/albums/${albumId}/photos`);
            state.photos = photos;
        } catch (error) {
            notify(`相册打开失败: ${error.message}`, 'error');
        }
    },

    /** 逐张上传（请求体就是文件本身，避免 multipart 依赖） */
    async uploadPhotos(fileList, note = '') {
        const album = state.currentAlbum;
        if (!album) return notify('请先选择相册', 'error');
        const files = Array.from(fileList || []);
        if (!files.length) return;

        state.upload = { busy: true, done: 0, total: files.length };
        for (const file of files) {
            try {
                const buffer = await file.arrayBuffer();
                const url = `/api/gallery/albums/${album.id}/photos`
                    + `?name=${encodeURIComponent(file.name)}&note=${encodeURIComponent(note)}&source=upload`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': file.type || 'image/jpeg' },
                    body: buffer
                });
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.message || `HTTP ${response.status}`);
                }
            } catch (error) {
                notify(`「${file.name}」上传失败: ${error.message}`, 'error');
            }
            state.upload.done += 1;
        }
        state.upload.busy = false;
        await this.loadAlbums();
        await this.openAlbum(album.id);
        notify(`已上传 ${state.upload.done} 张照片`);
    },

    async updatePhoto(photoId, patch) {
        try {
            const { photo } = await api(`/api/gallery/photos/${photoId}`, {
                method: 'POST',
                body: JSON.stringify(patch)
            });
            const index = state.photos.findIndex(item => item.id === photoId);
            if (index >= 0) state.photos[index] = photo;
            notify('照片已更新');
        } catch (error) {
            notify(`更新失败: ${error.message}`, 'error');
        }
    },

    async deletePhoto(photoId) {
        if (!window.confirm('删除这张照片？')) return;
        try {
            await api(`/api/gallery/photos/${photoId}`, { method: 'DELETE' });
            state.photos = state.photos.filter(item => item.id !== photoId);
            await this.loadAlbums();
            notify('照片已删除');
        } catch (error) {
            notify(`删除失败: ${error.message}`, 'error');
        }
    },

    async deleteAlbum(albumId, name) {
        if (!window.confirm(`删除相册「${name}」及其全部照片？此操作不可恢复。`)) return;
        try {
            await api(`/api/gallery/albums/${albumId}`, { method: 'DELETE' });
            if (state.currentAlbum?.id === albumId) {
                state.currentAlbum = null;
                state.photos = [];
            }
            await this.loadAlbums();
            notify('相册已删除');
        } catch (error) {
            notify(`删除失败: ${error.message}`, 'error');
        }
    },

    /** 一键出片：相册 → 项目 → 自动渲染 */
    async makeAlbumMv(albumId, options = {}) {
        setLoading(true, '相册 MV 渲染中…');
        try {
            const { projectId, jobId } = await api(`/api/gallery/albums/${albumId}/mv`, {
                method: 'POST',
                body: JSON.stringify({
                    pick: options.pick || 'sequential',
                    caption: options.caption || 'note',
                    title: options.title || ''
                })
            });
            for (let attempt = 0; attempt < 200; attempt += 1) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                const { job } = await api(`/api/jobs/${jobId}`);
                if (job.status === 'succeeded' || job.status === 'failed') {
                    await this.loadProjects();
                    await this.openProject(projectId);
                    state.tab = 'render';
                    notify(job.status === 'succeeded' ? '相册 MV 已生成' : `渲染失败: ${job.error || ''}`, job.status === 'succeeded' ? 'success' : 'error');
                    return;
                }
            }
            notify('渲染超时，请到项目里查看进度', 'error');
        } catch (error) {
            notify(`出片失败: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    },

    saveDraft(explicit = false) {
        const payload = {
            idea: state.create.idea,
            brief: state.create.brief,
            projectId: state.project?.id || null,
            savedAt: new Date().toISOString()
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
        if (explicit) notify('草稿已保存');
    },

    async loadDraft(explicit = false) {
        const draft = readLocal(DRAFT_KEY, null);
        if (!draft) return explicit && notify('没有可加载的草稿', 'error');
        state.create.idea = draft.idea || '';
        state.create.brief = draft.brief || null;
        if (draft.projectId) {
            try {
                await this.openProject(draft.projectId);
            } catch (error) {
                /* 项目可能已被删除，忽略 */
            }
        }
        if (explicit) notify('草稿已加载');
    },

    clearDraft() {
        localStorage.removeItem(DRAFT_KEY);
        state.create.idea = '';
        state.create.brief = null;
        notify('草稿已清空');
    }
};
