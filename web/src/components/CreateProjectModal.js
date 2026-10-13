import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import Modal from './Modal.js';
import { state, actions } from '../store.js';

const SAMPLE = '雨夜，他回到三年前出事的旧楼，电梯里却站着本该已经死去的她。';
const STAGE_LABEL = { pre: '前期', render: '渲染' };

export default defineComponent({
    name: 'CreateProjectModal',
    components: { Modal },
    data() {
        return { state, busy: false, stageLabel: STAGE_LABEL };
    },
    computed: {
        brief() {
            // 创意改过之后旧 Brief 就失效了，避免拿过期简报去立项
            return state.create.brief && state.create.brief.raw === state.create.idea.trim() ? state.create.brief : null;
        },
        templates() {
            return state.templates || [];
        }
    },
    mounted() {
        if (!state.templates.length) actions.loadTemplates();
    },
    methods: {
        ...actions,
        async analyze() {
            this.busy = true;
            await this.analyzeIdea();
            this.busy = false;
        },
        async create() {
            this.busy = true;
            await this.createProject();
            this.busy = false;
        },
        useSample() {
            state.create.idea = SAMPLE;
            state.create.brief = null;
        },
        stageText(template) {
            return (template.stages || []).map(stage => this.stageLabel[stage] || stage).join(' / ');
        },
        async removeTemplate(template) {
            if (!window.confirm(`删除模板「${template.name}」？已用它的项目不受影响。`)) return;
            await this.deleteTemplate(template.id);
        },
        async promptRename(template) {
            const name = window.prompt('模板名称', template.name);
            if (!name || name.trim() === template.name) return;
            await this.renameTemplate(template.id, name.trim());
        }
    },
    template: `
        <Modal :open="state.create.open" title="新建短片项目" @close="closeCreateModal()">
            <div class="field">
                <label>一句话创意</label>
                <textarea class="input-field" rows="4" v-model="state.create.idea"
                          placeholder="例：雨夜，他回到三年前出事的旧楼，电梯里却站着本该已经死去的她。"></textarea>
            </div>
            <div class="row-actions" style="margin-bottom: 1rem;">
                <button class="btn-secondary" :disabled="busy" @click="analyze()">解析创意（生成 Brief）</button>
                <button class="btn-secondary" @click="useSample()">用示例创意</button>
            </div>

            <div class="card" v-if="brief" style="margin-bottom: 0;">
                <div class="brief-readonly">
                    <div class="row"><em>标题</em><span>{{ brief.title }}</span></div>
                    <div class="row"><em>题材</em><span>{{ brief.genre }}　基调：{{ brief.tone }}</span></div>
                    <div class="row"><em>钩子</em><span>{{ brief.hook }}</span></div>
                    <div class="row"><em>关键词</em><span>{{ (brief.keywords || []).join(' · ') || '—' }}</span></div>
                    <div class="row"><em>规格</em><span>{{ brief.shots }} 镜头 / {{ brief.duration }}s（{{ brief.source === 'llm' ? '模型解析' : '规则解析' }}）</span></div>
                </div>
            </div>
            <p class="hint" v-else>可以直接创建（开会自动解析创意），也可以先解析成 Brief 再决定。</p>

            <div class="field" style="margin-top: 1rem;">
                <label>工作流模板</label>
                <div class="template-list">
                    <label class="template-item" v-for="template in templates" :key="template.id"
                           :class="{ active: state.create.templateId === template.id }">
                        <input type="radio" class="mark-checkbox" name="templateId"
                               :value="template.id" v-model="state.create.templateId">
                        <span class="template-body">
                            <span class="template-name">
                                {{ template.name }}
                                <span class="tag" v-if="template.builtin">内置</span>
                                <span class="tag" v-if="template.id === state.defaultTemplate">默认</span>
                            </span>
                            <span class="hint">{{ template.description }}</span>
                            <span class="hint">{{ template.nodeCount }} 个节点 · {{ stageText(template) }}</span>
                        </span>
                        <span class="row-actions" v-if="!template.builtin">
                            <button class="copy-btn-small" @click.prevent="promptRename(template)">重命名</button>
                            <button class="btn-delete" @click.prevent="removeTemplate(template)">删除</button>
                        </span>
                    </label>
                </div>
                <p class="hint" v-if="!templates.length">还没有可用的模板。</p>
            </div>

            <template #footer>
                <button class="btn-secondary" @click="closeCreateModal()">取消</button>
                <button class="btn-primary" :disabled="busy" @click="create()">
                    {{ busy ? '生成中…' : '创建项目（生成剧本与分镜）' }}
                </button>
            </template>
        </Modal>
    `
});
