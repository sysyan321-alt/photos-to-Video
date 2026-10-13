import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import { state, actions } from '../store.js';

const HOME_MENU = [
    { key: 'create', label: '创作' },
    { key: 'batch', label: '批量' },
    { key: 'analytics', label: '数据' },
    { key: 'providers', label: '模型接入' },
    { key: 'gallery', label: '我的相册' },
    { key: 'projects', label: '作品' },
    { key: 'prompts', label: '提示词库' }
];

const EXAMPLES = [
    '雨夜的天台，她把最后一封信折成纸飞机。',
    '阳台上的多肉冒出了第一片新叶。',
    '他把旧球鞋刷干净，放回鞋架最上层。'
];

/** 首页 = 创作台：一句话就能开始，作品列表退到次要位置 */
export default defineComponent({
    name: 'HomeView',
    components: { NavBar },
    data() {
        return { state, menu: HOME_MENU, activeMenu: 'create', examples: EXAMPLES };
    },
    computed: {
        statusText() {
            const health = state.health;
            if (!health) return '正在读取系统状态…';
            if (health.error) return `服务不可用: ${health.error}`;
            const models = health.models;
            const flags = [models.llm, models.image, models.i2v, models.tts].filter(item => item?.enabled).length;
            const mode = flags === 0 ? '离线兜底' : flags === 4 ? '全模型' : '混合';
            return `${mode} · 图像 ${models.image.enabled ? '✓' : '×'} 视频 ${models.i2v?.enabled ? '✓' : '×'} 配音 ${models.tts.enabled ? '✓' : '×'}`;
        },
        idea() {
            return state.create.idea;
        },
        brief() {
            return state.create.brief && state.create.brief.raw === String(state.create.idea || '').trim()
                ? state.create.brief
                : null;
        },
        recent() {
            return (state.projects || []).slice(0, 4);
        },
        albumCount() {
            return (state.albums || []).reduce((sum, album) => sum + (album.count || 0), 0);
        }
    },
    mounted() {
        if (!state.albums.length) actions.loadAlbums();
    },
    methods: {
        ...actions,
        onMenu(key) {
            if (key === 'batch') state.view = 'batch';
            if (key === 'analytics') state.view = 'analytics';
            if (key === 'providers') state.view = 'providers';
            if (key === 'gallery') state.view = 'gallery';
            if (key === 'projects') state.view = 'projects';
            if (key === 'prompts') state.promptsOpen = true;
        },
        pickExample(text) {
            state.create.idea = text;
            state.create.brief = null;
        },
        statusClass(project) {
            return `tag status-${project.status}`;
        },
        statusLabel(project) {
            return {
                draft: '草稿',
                storyboard_ready: '待渲染',
                awaiting_selection: '待选定',
                rendering: '渲染中',
                completed: '已成片',
                failed: '失败'
            }[project.status] || project.status;
        }
    },
    template: `
        <div class="container">
            <header class="home-header">
                <h1>生长相册<span class="sub">GrowAlbum</span></h1>
                <div class="header-actions">
                    <span class="status-chip">{{ statusText }}</span>
                    <NavBar :items="menu" v-model="activeMenu" size="sm" align="end" @select="onMenu" />
                </div>
            </header>

            <section class="compose">
                <h2>想拍点什么？</h2>
                <p class="hint">写一句话，剩下的交给它：写剧本、定画风、挑镜头、配旁白，最后合成 15 秒竖屏短片。</p>

                <textarea class="input-field compose-input" rows="4" v-model="state.create.idea"
                          placeholder="例：雨夜的天台，她把最后一封信折成纸飞机。"></textarea>

                <div class="compose-examples">
                    <span class="hint">试试：</span>
                    <button class="chip" v-for="item in examples" :key="item" @click="pickExample(item)">{{ item.slice(0, 10) }}…</button>
                </div>

                <div class="compose-actions">
                    <button class="btn-primary btn-large" :disabled="!idea.trim()" @click="createProject()">开始创作</button>
                    <button class="btn-secondary" :disabled="!idea.trim()" @click="analyzeIdea()">先解析创意</button>
                    <button class="btn-secondary" @click="state.view = 'gallery'">
                        从相册开始<span class="hint" v-if="albumCount">（{{ albumCount }} 张素材）</span>
                    </button>
                </div>

                <div class="brief-preview" v-if="brief">
                    <div class="brief-line"><em>标题</em><span>{{ brief.title }}</span></div>
                    <div class="brief-line"><em>题材</em><span>{{ brief.genre }} · {{ brief.tone }}</span></div>
                    <div class="brief-line"><em>钩子</em><span>{{ brief.hook }}</span></div>
                    <div class="brief-line"><em>关键词</em><span>{{ (brief.keywords || []).join(' · ') || '—' }}</span></div>
                </div>
            </section>

            <section class="card">
                <div class="card-header-with-btn">
                    <h3>最近作品</h3>
                    <button class="btn-secondary" @click="state.view = 'projects'">全部 {{ state.projects.length }} 个</button>
                </div>
                <div v-if="recent.length" class="recent-list">
                    <div class="recent-row" v-for="project in recent" :key="project.id" @click="openProject(project.id)">
                        <div class="recent-main">
                            <strong>{{ project.name || '(未命名)' }}</strong>
                            <span class="hint">{{ project.logline || '—' }}</span>
                        </div>
                        <span :class="statusClass(project)">{{ statusLabel(project) }}</span>
                        <span class="hint">{{ project.shotCount }} 镜头 / {{ project.targetDuration }}s</span>
                    </div>
                </div>
                <div class="asset-empty" v-else>还没有作品，上面写一句就能开始</div>
            </section>
        </div>
    `
});
