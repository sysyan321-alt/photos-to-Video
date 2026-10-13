import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import { api, fileUrl } from '../api.js';
import { state, actions } from '../store.js';

const MENU = [
    { key: 'home', label: '首页' },
    { key: 'gallery', label: '我的相册' },
    { key: 'filter', label: '图片筛选' },
    { key: 'projects', label: '作品' }
];

const PURPOSES = ['竖屏短片的钩子镜头', '短片封面图', '转场空镜', '情绪特写'];
const SORTS = [
    { key: 'score', label: 'AI 分数优先' },
    { key: 'time', label: '按上传时间' }
];

/** 图片筛选：模型打分 → 按分数排序 → 一键用于出片 */
export default defineComponent({
    name: 'AlbumFilterView',
    components: { NavBar },
    data() {
        // 注意：模板只能访问实例属性，模块常量必须挂到 data 上，否则下拉会是空的
        return {
            state, menu: MENU, activeMenu: 'filter',
            albumId: '', purpose: PURPOSES[0], sort: 'score',
            purposes: PURPOSES, sorts: SORTS,
            photos: [], busy: false, scoreJob: null, scoreTimer: null
        };
    },
    computed: {
        albums() {
            return state.albums || [];
        },
        sorted() {
            const list = [...this.photos];
            if (this.sort === 'score') list.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
            else list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            return list;
        },
        scoredCount() {
            return this.photos.filter(item => item.score !== undefined && item.score !== null).length;
        }
    },
    mounted() {
        actions.loadAlbums().then(() => {
            if (this.albums.length) {
                this.albumId = this.albums[0].id;
                this.load();
            }
        });
    },
    methods: {
        ...actions,
        onMenu(key) {
            if (key === 'home') state.view = 'home';
            if (key === 'gallery') state.view = 'gallery';
            if (key === 'projects') state.view = 'projects';
        },
        async load() {
            if (!this.albumId) return;
            const { photos } = await api(`/api/gallery/albums/${this.albumId}/photos`);
            this.photos = photos;
        },
        /** 启动打分任务：立刻返回 jobId，然后轮询进度（只补未打分的图） */
        async score() {
            if (!this.albumId) return this.notify('先选一个相册', 'error');
            const started = await this.startScoreJob(this.albumId, this.purpose, true);
            if (!started) return;
            this.busy = true;
            this.scoreJob = { id: started.jobId, total: started.total, done: 0, progress: 0, status: 'running', logs: [] };
            clearInterval(this.scoreTimer);
            this.scoreTimer = setInterval(async () => {
                const job = await this.refreshScoreJob(this.scoreJob.id);
                if (!job) return;
                this.scoreJob = job;
                if (['succeeded', 'failed', 'canceled'].includes(job.status)) {
                    clearInterval(this.scoreTimer);
                    this.busy = false;
                    await this.load();
                    this.notify(job.status === 'canceled' ? `已取消（完成 ${job.done}/${job.total}）` : `打分完成 ${job.done}/${job.total}`);
                }
            }, 2000);
        },
        async cancelScore() {
            if (!this.scoreJob) return;
            await this.cancelScoreJob(this.scoreJob.id);
        },
        async applyToProject() {
            if (!state.project) return this.notify('先打开一个项目（作品 → 打开），再回来应用', 'error');
            await this.useAlbum(this.albumId, this.sort === 'score' ? 'score' : 'sequential');
        },
        scoreClass(photo) {
            if (photo.score === undefined || photo.score === null) return 'tag';
            return photo.score >= 6 ? 'tag status-completed' : 'tag status-rendering';
        },
        openFull(photo) {
            window.open(fileUrl(photo.file), '_blank');
        }
    },
    template: `
        <div class="container">
            <header class="home-header">
                <h1>图片筛选<span class="sub">Filter</span></h1>
                <div class="header-actions">
                    <NavBar :items="menu" v-model="activeMenu" size="sm" align="end" @select="onMenu" />
                </div>
            </header>

            <section class="card">
                <div class="card-header-with-btn">
                    <h3>让模型替你挑图</h3>
                    <div class="row-actions">
                        <select class="input-field" v-model="albumId" style="width:auto;" @change="load()">
                            <option v-for="album in albums" :key="album.id" :value="album.id">{{ album.name }}（{{ album.count }}）</option>
                        </select>
                        <select class="input-field" v-model="purpose" style="width:auto;">
                            <option v-for="item in purposes" :key="item" :value="item">{{ item }}</option>
                        </select>
                        <button class="btn-primary" :disabled="busy" @click="score()">{{ busy ? '打分中…' : 'AI 打分' }}</button>
                    </div>
                </div>
                <p class="hint">
                    打分按「{{ purpose }}」判断，每张约 0.001 元。{{ scoredCount }}/{{ photos.length }} 张已有分数。
                    出片时选「AI 分数优先」，模型会自动挑高分图。
                </p>
                <div class="row-actions" style="margin-top: 0.8rem;">
                    <select class="input-field" v-model="sort" style="width:auto;">
                        <option v-for="item in sorts" :key="item.key" :value="item.key">{{ item.label }}</option>
                    </select>
                    <button class="btn-secondary" @click="applyToProject()">把此相册用于当前项目（{{ sort === 'score' ? '按分数' : '按顺序' }}取图）</button>
                    <button class="btn-secondary" @click="load()">刷新</button>
                </div>

                <div v-if="scoreJob" style="margin-top: 1rem;">
                    <div class="job-head">
                        <span>{{ scoreJob.status === 'running' ? '打分中' : (scoreJob.status === 'canceled' ? '已取消' : '已完成') }} {{ scoreJob.done || 0 }}/{{ scoreJob.total || 0 }}</span>
                        <div class="row-actions">
                            <span class="hint">{{ scoreJob.progress || 0 }}%</span>
                            <button class="btn-secondary" v-if="scoreJob.status === 'running'" @click="cancelScore()">取消</button>
                        </div>
                    </div>
                    <div class="bar"><div id="jobBar" :style="{ width: (scoreJob.progress || 0) + '%' }"></div></div>
                    <div class="hint" v-if="scoreJob.items && scoreJob.items.length" style="margin-top: 0.5rem;">
                        最近：{{ scoreJob.items.slice(-3).map(function (i) { return (i.score !== undefined ? i.score + ' 分' : '失败'); }).join(' · ') }}
                    </div>
                </div>
            </section>

            <div class="photo-grid" v-if="sorted.length">
                <div class="photo-card" v-for="photo in sorted" :key="photo.id">
                    <img :src="fileUrl(photo.thumb || photo.file)" :alt="photo.name" @click="openFull(photo)">
                    <div class="photo-body">
                        <div class="photo-meta">
                            <span :class="scoreClass(photo)">{{ photo.score === undefined || photo.score === null ? '未打分' : photo.score + ' 分' }}</span>
                            <span class="tag">{{ photo.width }}×{{ photo.height }}</span>
                        </div>
                        <div class="hint" v-if="photo.reason">{{ photo.reason }}</div>
                        <div class="hint" v-else-if="photo.note">{{ photo.note }}</div>
                    </div>
                </div>
            </div>
            <div class="asset-empty" v-else>这个相册还没有照片，先去「我的相册」上传</div>
        </div>
    `
});
