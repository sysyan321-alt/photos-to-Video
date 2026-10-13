import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';
import { api } from '../api.js';

const PICKS = [
    { key: 'sequential', label: '按顺序' },
    { key: 'random', label: '随机' },
    { key: 'score', label: '按智能选图分数优先' }
];

/** 画面来源：把你的相册照片直接作为镜头画面（关键帧 0 元） */
export default defineComponent({
    name: 'AlbumSourcePanel',
    data() {
        return { state, picks: PICKS, albumId: '', pick: 'sequential', photos: [] };
        // 说明：下面是数据字段的补充（photos 用于统计打分覆盖率）
    },
    computed: {
        albums() {
            return state.albums || [];
        },
        shots() {
            return state.project?.shots || [];
        },
        albumShots() {
            return this.shots.filter(shot => shot.image_source === 'album').length;
        }
    },
    mounted() {
        if (!state.albums.length) actions.loadAlbums().then(() => {
            if (this.albums.length) { this.albumId = this.albums[0].id; this.loadPhotos(); }
        });
        else if (this.albums.length && !this.albumId) { this.albumId = this.albums[0].id; this.loadPhotos(); }
    },
    methods: {
        ...actions,
        async apply() {
            if (!this.albumId) return this.notify('先选一个相册', 'error');
            await this.useAlbum(this.albumId, this.pick);
        },
        sourceText(shot) {
            if (shot.image_source === 'album') return shot.source_label || '相册照片';
            if (shot.image_source === 'panel') return '面板占位';
            return '模型生成';
        },
        async loadPhotos() {
            if (!this.albumId) return;
            try {
                const { photos } = await api(`/api/gallery/albums/${this.albumId}/photos`);
                this.photos = photos;
            } catch (error) {
                this.photos = [];
            }
        },
        scoredCount() {
            return this.photos.filter(photo => photo.score !== undefined && photo.score !== null).length;
        }
    },
    template: `
        <div>
            <div class="card">
                <div class="card-header-with-btn">
                    <h3>用相册照片作画面</h3>
                    <div class="row-actions">
                        <select class="input-field" v-model="albumId" style="width:auto;" @change="loadPhotos()">
                            <option v-for="album in albums" :key="album.id" :value="album.id">{{ album.name }}（{{ album.count }} 张）</option>
                        </select>
                        <select class="input-field" v-model="pick" style="width:auto;">
                            <option v-for="item in picks" :key="item.key" :value="item.key">{{ item.label }}</option>
                        </select>
                        <button class="btn-primary" @click="apply()">应用到本项目</button>
                    </div>
                </div>
                <p class="hint">
                    应用后每个镜头会分到一张你的照片作为画面，渲染时直接缩放裁切成 9:16 ——
                    <b>关键帧不调用图像模型，0 元</b>。图生视频、配音、合成都照常。
                </p>
                <p class="hint" v-if="photos.length">
                    该相册已打分 <b>{{ scoredCount() }}/{{ photos.length }}</b> 张。
                    <template v-if="pick === 'score' && scoredCount() < photos.length / 2">
                        ⚠ 分数不足一半，「按分数取图」会退化成近似顺序取图 ——
                    </template>
                    <button class="copy-btn-small" @click="state.view = 'filter'">去图片筛选打分</button>
                </p>
            </div>

            <div class="card">
                <h3>镜头画面来源（{{ albumShots }}/{{ shots.length }} 来自相册）</h3>
                <div class="table-wrap" style="margin-top: 1rem;">
                    <table>
                        <thead><tr><th>镜号</th><th>画面来源</th><th>字幕</th></tr></thead>
                        <tbody>
                            <tr v-for="shot in shots" :key="shot.shot_id">
                                <td>{{ shot.shot_id }}</td>
                                <td>
                                    <span class="tag" :class="shot.image_source === 'album' ? 'status-completed' : ''">{{ sourceText(shot) }}</span>
                                </td>
                                <td>{{ shot.caption }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="hint">改完来源后在「渲染与发布」里点渲染即可；关键帧来自相册时不产生图像模型费用。</p>
            </div>
        </div>
    `
});
