import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import { state, actions } from '../store.js';

const MENU = [
    { key: 'create', label: '创作' },
    { key: 'batch', label: '批量' },
    { key: 'gallery', label: '我的相册' },
    { key: 'projects', label: '作品' }
];

/** 批量生产：一次贴多条创意，串行排队渲染，逐条记账（配合预算护栏） */
export default defineComponent({
    name: 'BatchView',
    components: { NavBar },
    data() {
        return { state, menu: MENU, activeMenu: 'batch', text: '', timer: null };
    },
    computed: {
        ideas() {
            return this.text.split('\n').map(line => line.trim()).filter(Boolean);
        },
        batch() {
            return state.batch || null;
        },
        running() {
            return this.batch ? ['preparing', 'rendering'].includes(this.batch.status) : false;
        }
    },
    mounted() {
        actions.loadProjects();
        if (this.running) this.poll();
    },
    unmounted() {
        clearInterval(this.timer);
    },
    methods: {
        ...actions,
        onMenu(key) {
            if (key === 'create') state.view = 'home';
            if (key === 'gallery') state.view = 'gallery';
            if (key === 'projects') state.view = 'projects';
        },
        async start() {
            if (!this.ideas.length) return this.notify('至少写一条创意（一行一条）', 'error');
            await this.startBatch(this.ideas);
            this.poll();
        },
        poll() {
            clearInterval(this.timer);
            this.timer = setInterval(async () => {
                const finished = await this.refreshBatch();
                if (finished) clearInterval(this.timer);
            }, 3000);
        },
        statusLabel(status) {
            return {
                preparing: '准备中',
                rendering: '渲染中',
                done: '已完成',
                queued: '排队中',
                completed: '已成片',
                partial: '部分完成',
                failed: '失败'
            }[status] || status;
        }
    },
    template: `
        <div class="container">
            <header class="home-header">
                <h1>批量生产<span class="sub">Batch</span></h1>
                <div class="header-actions">
                    <NavBar :items="menu" v-model="activeMenu" size="sm" align="end" @select="onMenu" />
                    <button class="btn-secondary" @click="state.view = 'home'">返回创作台</button>
                </div>
            </header>

            <section class="compose">
                <h2>一次投多条创意</h2>
                <p class="hint">一行一条，最多 20 条。逐条立项、串行渲染 —— 串行是为了不撞限流，也让预算护栏能逐条生效、超支即停。</p>
                <textarea class="input-field compose-input" rows="6" v-model="text"
                          placeholder="阳台上的多肉冒出了第一片新叶。&#10;他把旧球鞋刷干净，放回鞋架最上层。"></textarea>
                <div class="compose-actions">
                    <button class="btn-primary btn-large" :disabled="!ideas.length || running" @click="start()">
                        {{ running ? '批次进行中…' : '开始批量（' + ideas.length + ' 条）' }}
                    </button>
                    <span class="hint" v-if="ideas.length">预计约 {{ (ideas.length * 0.12).toFixed(2) }} 元（不含视频模型）</span>
                </div>
            </section>

            <section class="card" v-if="batch">
                <div class="card-header-with-btn">
                    <h3>批次 {{ batch.id }}</h3>
                    <div class="row-actions">
                        <span class="tag">{{ statusLabel(batch.status) }}</span>
                        <span class="tag">累计 {{ (batch.spendYuan || 0).toFixed(3) }} 元</span>
                    </div>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead><tr><th>#</th><th>创意 / 作品名</th><th>状态</th><th>花费</th><th class="col-actions">操作</th></tr></thead>
                        <tbody>
                            <tr v-for="(item, index) in batch.items" :key="index">
                                <td>{{ index + 1 }}</td>
                                <td>{{ item.name || item.idea }}<br><span class="hint">{{ item.error || '' }}</span></td>
                                <td><span class="tag">{{ statusLabel(item.status) }}</span></td>
                                <td>{{ (item.spendYuan || 0).toFixed(3) }} 元</td>
                                <td><button class="copy-btn-small" v-if="item.projectId" @click="openProject(item.projectId)">打开</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    `
});
