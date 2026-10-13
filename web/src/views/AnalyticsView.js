import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import { state, actions } from '../store.js';

const MENU = [
    { key: 'create', label: '创作' },
    { key: 'batch', label: '批量' },
    { key: 'gallery', label: '我的相册' },
    { key: 'projects', label: '作品' },
    { key: 'analytics', label: '数据' }
];

/** 数据页：回填投放数据 → 看预设效果排行 → 把推荐应用到项目 */
export default defineComponent({
    name: 'AnalyticsView',
    components: { NavBar },
    data() {
        return {
            state,
            menu: MENU,
            activeMenu: 'analytics',
            form: { projectId: '', views: '', completion: '', likes: '' }
        };
    },
    computed: {
        projects() {
            return state.projects || [];
        },
        ranking() {
            return state.ranking || [];
        },
        recommend() {
            return state.recommend || [];
        }
    },
    mounted() {
        actions.loadProjects().then(() => {
            const completed = (state.projects || []).find(item => item.status === 'completed');
            if (completed && !this.form.projectId) this.form.projectId = completed.id;
        });
        actions.loadRanking('style');
    },
    methods: {
        ...actions,
        onMenu(key) {
            if (key === 'create') state.view = 'home';
            if (key === 'batch') state.view = 'batch';
            if (key === 'gallery') state.view = 'gallery';
            if (key === 'projects') state.view = 'projects';
        },
        async submit() {
            if (!this.form.projectId) return this.notify('先选一个作品', 'error');
            const ok = await this.recordMetrics(this.form.projectId, {
                views: Number(this.form.views) || 0,
                completion: Number(this.form.completion) || 0,
                likes: Number(this.form.likes) || 0
            });
            if (ok) {
                this.form.views = '';
                this.form.completion = '';
                this.form.likes = '';
                await this.loadRanking('style');
            }
        },
        async applyRecommend() {
            const ids = this.recommend.map(item => item.id);
            if (!ids.length) return this.notify('还没有可用的推荐', 'error');
            await this.applyPresetRecommendation(ids);
        }
    },
    template: `
        <div class="container">
            <header class="home-header">
                <h1>数据<span class="sub">Analytics</span></h1>
                <div class="header-actions">
                    <NavBar :items="menu" v-model="activeMenu" size="sm" align="end" @select="onMenu" />
                    <button class="btn-secondary" @click="state.view = 'home'">返回创作台</button>
                </div>
            </header>

            <section class="card">
                <h3>回填投放数据</h3>
                <p class="hint">完播率填小数（0.42 表示 42%）。数据只存本地，用来给提示词预设排效果。</p>
                <div class="brief-grid" style="margin-top: 1rem;">
                    <div class="field">
                        <label>作品</label>
                        <select class="input-field" v-model="form.projectId">
                            <option value="">请选择</option>
                            <option v-for="project in projects" :key="project.id" :value="project.id">
                                {{ project.name }}{{ project.metrics ? ' ✓' : '' }}
                            </option>
                        </select>
                    </div>
                    <div class="field"><label>播放量</label><input class="input-field" type="number" v-model="form.views"></div>
                    <div class="field"><label>完播率（0-1）</label><input class="input-field" type="number" step="0.01" v-model="form.completion"></div>
                    <div class="field"><label>点赞数</label><input class="input-field" type="number" v-model="form.likes"></div>
                </div>
                <button class="btn-primary" @click="submit()">回填并重算排行</button>
            </section>

            <section class="card">
                <div class="card-header-with-btn">
                    <h3>预设效果排行（画风）</h3>
                    <button class="btn-secondary" @click="loadRanking('style')">刷新</button>
                </div>
                <div class="table-wrap" v-if="ranking.length">
                    <table>
                        <thead><tr><th>#</th><th>预设</th><th>平均分</th><th>样本</th><th>最佳作品</th></tr></thead>
                        <tbody>
                            <tr v-for="(item, index) in ranking" :key="item.id">
                                <td>{{ index + 1 }}</td>
                                <td>{{ item.name }}</td>
                                <td>{{ item.avgScore }}</td>
                                <td>{{ item.samples }} 条</td>
                                <td>{{ item.bestProject.name }}（{{ item.bestProject.score }}）</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="asset-empty" v-else>还没有回填过数据 —— 上面填一条就能生成排行</div>
            </section>

            <section class="card">
                <div class="card-header-with-btn">
                    <h3>推荐组合</h3>
                    <button class="btn-primary" v-if="recommend.length" @click="applyRecommend()">应用到当前项目</button>
                </div>
                <div v-if="recommend.length">
                    <p class="hint">按历史完播表现推荐的画风预设：</p>
                    <div class="row-actions" style="margin-top: 0.6rem;">
                        <span class="tag" v-for="item in recommend" :key="item.id">{{ item.name }} · 均分 {{ item.avgScore }}</span>
                    </div>
                    <p class="hint">应用后写入项目提示词槽位；下次重新组装/渲染时生效（已有素材命中缓存，不额外花钱）。</p>
                </div>
                <div class="asset-empty" v-else>回填至少一条数据后，这里会给出推荐</div>
            </section>
        </div>
    `
});
