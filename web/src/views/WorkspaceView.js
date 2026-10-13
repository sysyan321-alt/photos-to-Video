import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import BriefPanel from '../panels/BriefPanel.js';
import ScriptPanel from '../panels/ScriptPanel.js';
import ShotsPanel from '../panels/ShotsPanel.js';
import AssetsPanel from '../panels/AssetsPanel.js';
import RenderPanel from '../panels/RenderPanel.js';
import PromptPanel from '../panels/PromptPanel.js';
import VariantsPanel from '../panels/VariantsPanel.js';
import WorkflowPanel from '../panels/WorkflowPanel.js';
import RefsPanel from '../panels/RefsPanel.js';
import QualityPanel from '../panels/QualityPanel.js';
import PublishPanel from '../panels/PublishPanel.js';
import ReviewPanel from '../panels/ReviewPanel.js';
import AlbumSourcePanel from '../panels/AlbumSourcePanel.js';
import { state, actions } from '../store.js';

export default defineComponent({
    name: 'WorkspaceView',
    components: { NavBar, BriefPanel, ScriptPanel, ShotsPanel, PromptPanel, VariantsPanel, WorkflowPanel, RefsPanel, AlbumSourcePanel, QualityPanel, ReviewPanel, PublishPanel, AssetsPanel, RenderPanel },
    data() {
        return { state };
    },
    computed: {
        // 菜单栏只是数据：换一组 items 就能变成另一条工作流的导航
        menuItems() {
            const project = state.project;
            return [
                { key: 'brief', label: '创意 Brief' },
                { key: 'script', label: '剧本与角色', badge: project?.script?.beats?.length || '' },
                { key: 'shots', label: '分镜表', badge: project?.shots?.length || '' },
                { key: 'prompts', label: '提示词槽位' },
                { key: 'variants', label: '方向对比', badge: project?.variants?.length || '' },
                { key: 'workflow', label: '工作流' },
                { key: 'refs', label: '角色参考图', badge: project?.characterRefs?.length || '' },
                { key: 'album', label: '相册画面' },
                { key: 'quality', label: '质量检查' },
                { key: 'review', label: '审核' },
                { key: 'publish', label: '发布' },
                { key: 'assets', label: '关键帧素材', badge: project?.assets?.keyframes?.length || '' },
                { key: 'render', label: '渲染与发布' }
            ];
        },
        pathText() {
            return state.project ? `/data/growalbum/projects/${state.project.id}` : '';
        }
    },
    methods: {
        ...actions,
        copyProjectPath() {
            this.copy(this.pathText, '项目路径已复制');
        }
    },
    template: `
        <div class="workspace-container" v-if="state.project">
            <header class="workspace-header">
                <button class="btn-back" @click="backToHome()">← 返回</button>
                <h2>{{ state.project.name }}</h2>
                <div class="workspace-info">
                    <span>{{ pathText }}</span>
                    <button class="copy-btn-small" @click="copyProjectPath()">复制路径</button>
                </div>
                <div class="workspace-actions">
                    <button class="btn-secondary" @click="saveDraft(true)">保存草稿</button>
                    <button class="btn-secondary" @click="loadDraft(true)">加载草稿</button>
                    <button class="btn-secondary" @click="clearDraft()">清空草稿</button>
                    <button class="btn-primary" :disabled="!state.project.shots || !state.project.shots.length || (state.job && state.job.status === 'running')" @click="startRender()">
                        {{ state.job && state.job.status === 'running' ? '渲染中…' : '渲染 15 秒成片' }}
                    </button>
                </div>
            </header>

            <NavBar :items="menuItems" v-model="state.tab" />

            <div class="tab-content">
                <BriefPanel v-if="state.tab === 'brief'" />
                <ScriptPanel v-else-if="state.tab === 'script'" />
                <ShotsPanel v-else-if="state.tab === 'shots'" />
                <PromptPanel v-else-if="state.tab === 'prompts'" />
                <VariantsPanel v-else-if="state.tab === 'variants'" />
                <WorkflowPanel v-else-if="state.tab === 'workflow'" />
                <RefsPanel v-else-if="state.tab === 'refs'" />
                <AlbumSourcePanel v-else-if="state.tab === 'album'" />
                <QualityPanel v-else-if="state.tab === 'quality'" />
                <ReviewPanel v-else-if="state.tab === 'review'" />
                <PublishPanel v-else-if="state.tab === 'publish'" />
                <AssetsPanel v-else-if="state.tab === 'assets'" />
                <RenderPanel v-else-if="state.tab === 'render'" />
            </div>
        </div>
    `
});
