import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import Modal from '../components/Modal.js';
import { api } from '../api.js';
import { state, actions } from '../store.js';

const MENU = [
    { key: 'create', label: '创作' },
    { key: 'batch', label: '批量' },
    { key: 'gallery', label: '我的相册' },
    { key: 'analytics', label: '数据' },
    { key: 'projects', label: '作品' }
];

const STATUS_LABEL = {
    draft: '草稿',
    storyboard_ready: '待渲染',
    awaiting_selection: '待选定',
    rendering: '渲染中',
    completed: '已成片',
    failed: '失败'
};

/** 作品页：竖版海报网格 + 就地播放预览 */
export default defineComponent({
    name: 'ProjectsView',
    components: { NavBar, Modal },
    data() {
        return { state, menu: MENU, activeMenu: 'projects', preview: null, detail: null };
    },
    computed: {
        projects() {
            return state.projects || [];
        }
    },
    methods: {
        ...actions,
        onMenu(key) {
            if (key === 'create') state.view = 'home';
            if (key === 'batch') state.view = 'batch';
            if (key === 'gallery') state.view = 'gallery';
            if (key === 'analytics') state.view = 'analytics';
        },
        coverOf(project) {
            return project.poster || project.keyframe || null;
        },
        statusText(project) {
            return STATUS_LABEL[project.status] || project.status;
        },
        statusClass(project) {
            return `tag status-${project.status}`;
        },
        formatDate(value) {
            if (!value) return '';
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        },
        /** 就地预览：先打开弹窗，再补全分镜等信息 */
        async openPreview(project) {
            if (!project.video) return this.notify('这个作品还没有成片', 'error');
            this.preview = project;
            this.detail = null;
            try {
                const { project: full } = await api(`/api/projects/${project.id}`);
                this.detail = full;
            } catch (error) {
                /* 详情拿不到也不影响播放 */
            }
        },
        shotSummary() {
            const shots = this.detail?.shots || [];
            return shots.map(shot => `${shot.shot_id} ${shot.shot_size}/${shot.camera} 「${shot.caption}」`).join('\n');
        }
    },
    template: `
        <div class="container">
            <header class="home-header">
                <h1>作品<span class="sub">Projects</span></h1>
                <div class="header-actions">
                    <NavBar :items="menu" v-model="activeMenu" size="sm" align="end" @select="onMenu" />
                    <button class="btn-secondary" @click="state.view = 'home'">返回创作台</button>
                    <button class="btn-primary" @click="openCreateModal()">新建作品</button>
                </div>
            </header>

            <div class="poster-grid" v-if="projects.length">
                <div class="poster-card" v-for="project in projects" :key="project.id">
                    <div class="poster-media" @click="openPreview(project)">
                        <img v-if="coverOf(project)" :src="fileUrl(coverOf(project))" :alt="project.name" loading="lazy">
                        <div v-else class="poster-fallback">{{ (project.name || '·').slice(0, 1) }}</div>
                        <span class="poster-status" :class="statusClass(project)">{{ statusText(project) }}</span>
                        <span class="poster-duration" v-if="project.targetDuration">{{ project.targetDuration }}s</span>
                        <div class="poster-play" v-if="project.video">▶</div>
                        <div class="poster-hover" @click.stop>
                            <button class="poster-btn" v-if="project.video" @click="openPreview(project)">预览</button>
                            <button class="poster-btn" v-else @click="openProject(project.id)">打开</button>
                            <a class="poster-btn" v-if="project.video" :href="'/api/projects/' + project.id + '/download'">下载</a>
                            <button class="poster-btn danger" @click="deleteProject(project.id, project.name)">删除</button>
                        </div>
                    </div>
                    <div class="poster-body" @click="openProject(project.id)">
                        <strong>{{ project.name || '(未命名)' }}</strong>
                        <span class="hint">{{ project.genre || '' }}{{ project.genre && project.shotCount ? ' · ' : '' }}{{ project.shotCount }} 镜头 · {{ formatDate(project.createdAt) }}</span>
                    </div>
                </div>
            </div>

            <div class="empty-state" v-else>
                <p>还没有作品</p>
                <button class="btn-primary" @click="openCreateModal()">新建第一个作品</button>
            </div>

            <Modal :open="!!preview" :title="preview ? preview.name : ''" @close="preview = null">
                <video v-if="preview" class="preview-image" :src="fileUrl(preview.video)" controls autoplay playsinline></video>
                <div class="brief-readonly" style="margin-top: 1rem;" v-if="preview">
                    <div class="row"><em>规格</em><span>{{ preview.targetDuration }}s · {{ preview.shotCount }} 镜头 · {{ preview.genre || '—' }}</span></div>
                    <div class="row" v-if="detail"><em>剧情</em><span>{{ detail.script?.logline || '—' }}</span></div>
                    <div class="row" v-if="detail?.outputs"><em>成片</em><span>{{ detail.outputs.resolution }} · {{ detail.outputs.duration }}s · {{ (detail.outputs.sizeBytes / 1024 / 1024).toFixed(2) }}MB</span></div>
                </div>
                <template #footer>
                    <a class="download" v-if="preview" :href="'/api/projects/' + preview.id + '/download'">下载成片</a>
                    <button class="btn-secondary" v-if="preview" @click="openProject(preview.id); preview = null">进入项目</button>
                </template>
            </Modal>
        </div>
    `
});
