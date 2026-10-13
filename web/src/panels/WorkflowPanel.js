import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

const STAGE_LABEL = { pre: '前期', render: '渲染' };
// 节点 → provider 类型的兜底映射（节点库/编排里带 providerKind 时以它为准）
const PROVIDER_KIND = {
    brief: 'llm', script: 'llm', storyboard: 'llm', review: 'llm',
    variants: 'image', keyframe: 'image', shot_video: 'i2v', voice: 'tts'
};

/**
 * 工作流编辑器：
 * 1) 整条链横排成段，每个节点显示名称 / 阶段 / provider / 启停；可拖拽排序
 * 2) 点节点打开右侧抽屉改参数（POST /api/projects/:id/nodes/:nodeId/params）
 * 3) 启停/增删后按 requires/produces 在前端实时推演契约，缺上游产物立刻标红
 * 4) 增删 / 排序统一走 POST /api/projects/:id/workflow/nodes；「存为我的模板」走 POST /api/workflows
 */
export default defineComponent({
    name: 'WorkflowPanel',
    data() {
        return {
            state,
            stageLabel: STAGE_LABEL,
            selectedId: null,
            saving: false,
            busy: false,
            pendingAdd: '',
            dragIndex: null,
            dragOverIndex: null,
            form: {},
            jsonText: {},
            paramKinds: {}
        };
    },
    computed: {
        /** 元数据来源：节点库优先（含全部 13 个节点），老模板描述兜底 */
        descriptors() {
            return state.nodeLibrary.length ? state.nodeLibrary : (state.workflowTemplate?.nodes || []);
        },
        nodes() {
            const stored = state.project?.workflow?.nodes;
            const base = Array.isArray(stored) && stored.length ? stored : this.descriptors;
            return base.map(node => {
                const meta = this.descriptors.find(item => item.id === node.id) || {};
                return {
                    ...meta,
                    ...node,
                    requires: node.requires ?? meta.requires ?? [],
                    produces: node.produces ?? meta.produces ?? [],
                    providerKind: node.providerKind ?? meta.providerKind ?? null,
                    params: { ...(meta.params || {}), ...(node.params || {}) }
                };
            });
        },
        addableNodes() {
            const used = new Set(this.nodes.map(node => node.id));
            return this.descriptors.filter(item => !used.has(item.id));
        },
        templateName() {
            return state.project?.workflow?.templateName || state.workflowTemplate?.name || '-';
        },
        providerState() {
            return state.health?.providers || {};
        },
        selectedNode() {
            return this.nodes.find(node => node.id === this.selectedId) || null;
        },
        /** 项目里已经存在的产物——和引擎 availableArtifacts 对齐，用于离线推演契约 */
        availableArtifacts() {
            const project = state.project || {};
            const set = new Set();
            if (project.brief?.genre) set.add('brief');
            if (project.script) set.add('script');
            if (project.shots?.length) set.add('shots');
            if (project.shots?.some(shot => shot.keyframe_prompt)) set.add('prompt@shot');
            if (project.shots?.some(shot => shot.image_source)) set.add('image_source@shot');
            if ((project.assets?.keyframes || []).some(item => item?.path)) set.add('keyframe@shot');
            if (project.assets?.clips?.length) set.add('clip@shot');
            if (project.assets?.audio) set.add('audio');
            if (project.outputs?.video) set.add('video');
            if (project.publishPack) set.add('publish_pack');
            return set;
        },
        /** 与后端 validateChain 同构：逐个启用节点检查 requires，缺产物则记录问题 */
        validationProblems() {
            const available = new Set(this.availableArtifacts);
            const problems = [];
            for (const node of this.nodes) {
                if (!node.enabled) continue;
                const missing = (node.requires || [])
                    .filter(requirement => {
                        const group = Array.isArray(requirement) ? requirement : [requirement];
                        return !group.some(item => available.has(item));
                    })
                    .map(requirement => (Array.isArray(requirement) ? requirement.join(' 或 ') : requirement));
                if (missing.length) {
                    problems.push(`节点「${node.label}」需要 ${missing.join('、')} 的产物，但上游没有产出（节点被停用/移除，项目里也不存在）`);
                    continue;
                }
                for (const artifact of node.produces || []) available.add(artifact);
            }
            return problems;
        },
        hasWorkflow() {
            return Boolean(state.project?.workflow?.templateId || this.nodes.length);
        }
    },
    mounted() {
        if (!state.nodeLibrary.length) actions.loadNodeLibrary();
    },
    methods: {
        ...actions,
        providerKindOf(node) {
            return node.providerKind || PROVIDER_KIND[node.id] || null;
        },
        providerShort(node) {
            const kind = this.providerKindOf(node);
            if (!kind) return '本地';
            const info = this.providerState[kind];
            return info?.kindLabel || kind;
        },
        providerInfo(node) {
            const kind = this.providerKindOf(node);
            if (!kind) return '本地（不需要 Key）';
            const info = this.providerState[kind];
            if (!info) return '-';
            return `${info.label}${info.enabled ? ' ✓' : ' × 未配置'}`;
        },
        paramSummary(node) {
            const params = node.params || {};
            const keys = Object.keys(params).filter(key => params[key] !== null && params[key] !== undefined);
            if (!keys.length) return '—';
            return keys.slice(0, 3).map(key => {
                const value = params[key];
                if (Array.isArray(value)) return `${key}: ${value.length} 项`;
                if (typeof value === 'object') return `${key}: 对象`;
                return `${key}: ${value}`;
            }).join('　');
        },
        artifactText(list) {
            if (!list?.length) return '—';
            return list.map(item => (Array.isArray(item) ? item.join(' 或 ') : item)).join('、');
        },
        isSelected(node) {
            return node.id === this.selectedId;
        },
        descriptorFor(id) {
            return this.descriptors.find(item => item.id === id) || null;
        },
        paramKeys(node) {
            const keys = new Set(Object.keys(node.params || {}));
            const meta = this.descriptorFor(node.id);
            for (const key of Object.keys(meta?.params || {})) keys.add(key);
            return [...keys];
        },
        valueFor(node, key) {
            if (node.params && node.params[key] !== undefined) return node.params[key];
            const meta = this.descriptorFor(node.id);
            return meta?.params?.[key];
        },
        kindOfValue(value) {
            if (typeof value === 'boolean') return 'boolean';
            if (typeof value === 'number') return 'number';
            if (Array.isArray(value) || (value && typeof value === 'object')) return 'json';
            return 'auto';
        },
        /** 打开抽屉：把节点参数按值类型拆成「标量表单」和「JSON 文本」两份草稿 */
        openDrawer(node) {
            this.selectedId = node.id;
            this.form = {};
            this.jsonText = {};
            this.paramKinds = {};
            for (const key of this.paramKeys(node)) {
                const value = this.valueFor(node, key);
                const kind = this.kindOfValue(value);
                this.paramKinds[key] = kind;
                if (kind === 'json') this.jsonText[key] = JSON.stringify(value, null, 2);
                else this.form[key] = value === null || value === undefined ? '' : value;
            }
        },
        closeDrawer() {
            this.selectedId = null;
        },
        /** 按给定 id 顺序整条保存（拖拽 / 上移下移 / 增删都复用它） */
        async persistOrder(ids) {
            if (this.busy) return false;
            const byId = new Map(this.nodes.map(node => [node.id, node]));
            const list = ids.map(id => byId.get(id)).filter(Boolean);
            this.busy = true;
            const ok = await this.saveWorkflowNodes(list);
            this.busy = false;
            return ok;
        },
        onDragStart(index) {
            this.dragIndex = index;
        },
        onDragOver(index) {
            this.dragOverIndex = index;
        },
        onDragEnd() {
            this.dragIndex = null;
            this.dragOverIndex = null;
        },
        async onDrop(index) {
            const from = this.dragIndex;
            this.onDragEnd();
            if (from === null || from === index) return;
            const ids = this.nodes.map(node => node.id);
            const [moved] = ids.splice(from, 1);
            ids.splice(index, 0, moved);
            await this.persistOrder(ids);
        },
        async moveNode(index, delta) {
            const ids = this.nodes.map(node => node.id);
            const target = index + delta;
            if (target < 0 || target >= ids.length) return;
            [ids[index], ids[target]] = [ids[target], ids[index]];
            await this.persistOrder(ids);
        },
        async addNode() {
            if (!this.pendingAdd) return;
            const list = this.nodes.map(node => ({ id: node.id, enabled: node.enabled, params: node.params }));
            list.push({ id: this.pendingAdd, enabled: true, params: {} });
            const ok = await this.saveWorkflowNodes(list);
            if (ok) this.pendingAdd = '';
        },
        async removeNode(node) {
            if (this.nodes.length <= 1) return this.notify('工作流至少要保留一个节点', 'error');
            if (!window.confirm(`从工作流移除「${node.label}」？`)) return;
            const ids = this.nodes.filter(item => item.id !== node.id).map(item => item.id);
            const ok = await this.persistOrder(ids);
            if (ok && this.selectedId === node.id) this.closeDrawer();
        },
        async toggle(node) {
            await this.setNodeEnabled(node.id, !node.enabled);
        },
        async toggleDrawerEnabled() {
            const node = this.selectedNode;
            if (!node) return;
            await this.setNodeEnabled(node.id, !node.enabled);
        },
        async saveParams() {
            const node = this.selectedNode;
            if (!node || this.saving) return;
            const params = {};
            const invalid = [];
            for (const key of Object.keys(this.paramKinds)) {
                const kind = this.paramKinds[key];
                if (kind === 'json') {
                    const text = String(this.jsonText[key] ?? '').trim();
                    if (!text) continue;
                    try {
                        params[key] = JSON.parse(text);
                    } catch (error) {
                        invalid.push(key);
                    }
                    continue;
                }
                const raw = this.form[key];
                if (kind === 'boolean') params[key] = Boolean(raw);
                else if (kind === 'number') {
                    const value = Number(raw);
                    params[key] = Number.isFinite(value) ? value : 0;
                } else {
                    const text = String(raw ?? '').trim();
                    params[key] = text === '' ? null : text;
                }
            }
            if (invalid.length) return this.notify(`这些参数不是合法 JSON：${invalid.join('、')}`, 'error');
            this.saving = true;
            const ok = await this.setNodeParams(node.id, params);
            this.saving = false;
            if (ok) {
                const fresh = this.nodes.find(item => item.id === node.id);
                if (fresh) this.openDrawer(fresh);
            }
        },
        resetParams() {
            const node = this.selectedNode;
            if (!node) return;
            const meta = this.descriptorFor(node.id);
            this.openDrawer({ ...node, params: { ...(meta?.params || {}) } });
        },
        async save() {
            const name = window.prompt('模板名称', `${state.project?.name || '我的'}模板`);
            if (!name) return;
            await this.saveTemplate(name.trim());
        }
    },
    template: `
        <div v-if="!hasWorkflow" class="card">
            <p class="hint">该项目还没有绑定工作流模板（老项目）。请用当前模板重新生成一次前期，或新建项目。</p>
        </div>
        <div v-else>
            <div class="card">
                <div class="card-header-with-btn">
                    <h3>工作流：{{ templateName }}</h3>
                    <div class="row-actions">
                        <select class="input-field add-node-select" v-model="pendingAdd" :disabled="!addableNodes.length">
                            <option value="">{{ addableNodes.length ? '添加节点…' : '节点已全部在链上' }}</option>
                            <option v-for="item in addableNodes" :key="item.id" :value="item.id">{{ item.label }}（{{ stageLabel[item.stage] || item.stage }}）</option>
                        </select>
                        <button class="btn-secondary" :disabled="!pendingAdd || busy" @click="addNode()">加入</button>
                        <span class="tag">{{ nodes.filter(n => n.enabled).length }} / {{ nodes.length }} 个节点启用</span>
                        <button class="btn-secondary" @click="save()">存为我的模板</button>
                    </div>
                </div>

                <div class="node-chain">
                    <template v-for="(node, index) in nodes" :key="node.id">
                        <button
                            class="node-chip"
                            :class="{ off: !node.enabled, active: isSelected(node), dragging: dragIndex === index, 'drag-over': dragOverIndex === index && dragIndex !== index }"
                            draggable="true"
                            @click="openDrawer(node)"
                            @dragstart="onDragStart(index)"
                            @dragover.prevent="onDragOver(index)"
                            @drop.prevent="onDrop(index)"
                            @dragend="onDragEnd()"
                        >
                            <span class="node-index">{{ index + 1 }}<span class="drag-hint">⋮⋮</span></span>
                            <span class="node-name">{{ node.label }}</span>
                            <span class="node-meta">
                                <span class="chip-badge">{{ stageLabel[node.stage] || node.stage }}</span>
                                <span class="chip-badge provider">{{ providerShort(node) }}</span>
                            </span>
                            <span class="node-state">{{ node.enabled ? '● 启用' : '○ 停用' }}</span>
                        </button>
                        <span class="chain-arrow" v-if="index < nodes.length - 1">→</span>
                    </template>
                </div>

                <p class="hint">拖动节点可排序（或在下表用 ↑ ↓）；点节点打开右侧抽屉改参数；改动会实时做契约校验。</p>
            </div>

            <div class="card">
                <h3>节点清单</h3>
                <div class="table-wrap" style="margin-top: 1rem;">
                    <table>
                        <thead>
                            <tr><th>#</th><th>节点</th><th>阶段</th><th>Provider</th><th>参数</th><th class="col-actions-wide">操作</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="(node, index) in nodes" :key="node.id" :class="{ 'row-off': !node.enabled }">
                                <td>{{ index + 1 }}</td>
                                <td>
                                    <button class="link-btn" @click="openDrawer(node)">{{ node.label }}</button>
                                    <br><span class="hint">{{ node.id }}</span>
                                </td>
                                <td>{{ stageLabel[node.stage] || node.stage }}</td>
                                <td>{{ providerInfo(node) }}</td>
                                <td>{{ paramSummary(node) }}</td>
                                <td>
                                    <div class="row-actions">
                                        <button class="copy-btn-small" @click="moveNode(index, -1)" :disabled="index === 0 || busy" title="上移">↑</button>
                                        <button class="copy-btn-small" @click="moveNode(index, 1)" :disabled="index === nodes.length - 1 || busy" title="下移">↓</button>
                                        <button class="copy-btn-small" @click="openDrawer(node)">参数</button>
                                        <button class="copy-btn-small" @click="toggle(node)">{{ node.enabled ? '停用' : '启用' }}</button>
                                        <button class="btn-delete" @click="removeNode(node)" :disabled="busy">移除</button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card" :class="{ 'card-error': validationProblems.length }">
                <h3>契约校验</h3>
                <template v-if="validationProblems.length">
                    <p class="hint error-text" v-for="problem in validationProblems" :key="problem">⚠ {{ problem }}</p>
                </template>
                <p class="hint" v-else>✔ 当前启停组合自洽：每个启用节点的上游产物都拿得到。</p>
                <p class="hint">「存为我的模板」会固化当前顺序、启停与参数，之后建项目时可选。</p>
            </div>

            <div class="drawer" :class="{ open: !!selectedNode }" @click.self="closeDrawer()">
                <div class="drawer-panel" v-if="selectedNode">
                    <div class="drawer-header">
                        <div>
                            <h3>{{ selectedNode.label }}</h3>
                            <span class="hint">{{ selectedNode.id }} · {{ stageLabel[selectedNode.stage] || selectedNode.stage }}</span>
                        </div>
                        <button class="close-btn" @click="closeDrawer()">×</button>
                    </div>
                    <div class="drawer-body">
                        <div class="drawer-row">
                            <span class="text-label">Provider</span>
                            <span>{{ providerInfo(selectedNode) }}</span>
                        </div>
                        <div class="drawer-row">
                            <span class="text-label">上游产物</span>
                            <span>{{ artifactText(selectedNode.requires) }}</span>
                        </div>
                        <div class="drawer-row">
                            <span class="text-label">产出</span>
                            <span>{{ artifactText(selectedNode.produces) }}</span>
                        </div>
                        <div class="drawer-row">
                            <span class="text-label">启停</span>
                            <button class="copy-btn-small" @click="toggleDrawerEnabled()">{{ selectedNode.enabled ? '停用此节点' : '启用此节点' }}</button>
                        </div>

                        <div class="drawer-section">
                            <h4>参数</h4>
                            <p class="hint" v-if="!Object.keys(paramKinds).length">该节点没有可调参数。</p>
                            <div class="field" v-for="key in Object.keys(paramKinds)" :key="key">
                                <label>{{ key }}</label>
                                <label class="slot-item" v-if="paramKinds[key] === 'boolean'">
                                    <input type="checkbox" class="mark-checkbox" v-model="form[key]">
                                    <span>{{ form[key] ? '开' : '关' }}</span>
                                </label>
                                <input v-else-if="paramKinds[key] === 'number'" class="input-field" type="number" v-model.number="form[key]">
                                <textarea v-else-if="paramKinds[key] === 'json'" class="input-field" rows="5" v-model="jsonText[key]"></textarea>
                                <input v-else class="input-field" v-model="form[key]" placeholder="留空表示不设置">
                            </div>
                        </div>

                        <p class="hint error-text" v-for="problem in validationProblems" :key="'d' + problem">⚠ {{ problem }}</p>
                    </div>
                    <div class="drawer-footer">
                        <button class="btn-delete" @click="removeNode(selectedNode)" :disabled="busy">移除节点</button>
                        <button class="btn-secondary" @click="resetParams()">恢复默认</button>
                        <button class="btn-primary" :disabled="saving" @click="saveParams()">{{ saving ? '保存中…' : '保存参数' }}</button>
                    </div>
                </div>
            </div>
        </div>
    `
});
