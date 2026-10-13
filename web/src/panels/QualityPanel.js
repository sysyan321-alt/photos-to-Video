import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

/** 质量检查：智能选图（挑钩子/封面）+ 一致性检查（挑跑样镜头） */
export default defineComponent({
    name: 'QualityPanel',
    data() {
        return { state, albumId: '', pick: null, consistency: null, story: null, threshold: 6 };
    },
    computed: {
        albums() {
            return state.albums || [];
        },
        refs() {
            return state.project?.characterRefs || [];
        }
    },
    mounted() {
        actions.loadAlbums().then(() => {
            if (this.albums.length && !this.albumId) this.albumId = this.albums[0].id;
        });
    },
    methods: {
        ...actions,
        async runPick() {
            return this.pickRun();
        },
        async pickRun() {
            if (!this.albumId) return this.notify('先选择一个相册', 'error');
            this.pick = await this.pickBestPhotos(this.albumId, '竖屏短剧的钩子镜头', 3);
        },
        async runStory() {
            if (!this.albumId) return this.notify('先选择一个相册', 'error');
            const data = await this.albumStory(this.albumId, { shots: 5, createProject: false });
            if (data) this.story = data.story;
        },
        async createFromStory() {
            if (!this.albumId) return;
            await this.albumStory(this.albumId, { shots: 5, createProject: true });
        },
        async runCheck() {
            this.consistency = await this.runConsistencyCheck(Number(this.threshold) || 6, 10);
        },
        async useAsRef(photoId) {
            await this.setCharacterRefs([photoId]);
        }
    },
    template: `
        <div>
            <div class="card">
                <div class="card-header-with-btn">
                    <h3>相册 → 故事（素材驱动创意）</h3>
                    <div class="row-actions">
                        <select class="input-field" v-model="albumId" style="width:auto;">
                            <option v-for="album in albums" :key="album.id" :value="album.id">{{ album.name }}（{{ album.count }}）</option>
                        </select>
                        <button class="btn-secondary" @click="runStory()">读图写故事</button>
                        <button class="btn-primary" v-if="story" @click="createFromStory()">用它建项目</button>
                    </div>
                </div>
                <div v-if="story">
                    <p class="hint" style="margin-top: 0.6rem;"><b>{{ story.title }}</b> · {{ story.logline }}</p>
                    <div class="saved-prompt" v-for="beat in story.beats" :key="beat.index">
                        <div class="text-label">节拍 {{ beat.index }}</div>
                        <div class="text-content">{{ beat.caption }}</div>
                        <div class="text-content" style="color: var(--text-secondary); font-size: 0.72rem;">{{ beat.action }}</div>
                    </div>
                </div>
                <p class="hint" v-else>模型会读你相册里的图，写出一部竖屏短剧的梗概与 5 个节拍（约 0.01 元），满意后可一键立项。</p>
            </div>

            <div class="card">
                <div class="card-header-with-btn">
                    <h3>智能选图（挑钩子镜头 / 封面）</h3>
                    <div class="row-actions">
                        <select class="input-field" v-model="albumId" style="width:auto;">
                            <option v-for="album in albums" :key="album.id" :value="album.id">{{ album.name }}（{{ album.count }}）</option>
                        </select>
                        <button class="btn-primary" @click="runPick()">开始打分</button>
                    </div>
                </div>
                <div v-if="pick">
                    <div class="saved-prompt" v-for="(item, index) in pick.ranked" :key="item.photoId">
                        <div class="text-item-header">
                            <span class="text-label">#{{ index + 1 }} · {{ item.score }} 分</span>
                            <span class="row-actions">
                                <button class="copy-btn-small" @click="useAsRef(item.photoId)">设为参考图</button>
                            </span>
                        </div>
                        <div class="text-content">{{ item.reason }}</div>
                    </div>
                </div>
                <p class="hint" v-else>打分成本约 0.001 元/张，默认只打前 8 张。</p>
            </div>

            <div class="card">
                <div class="card-header-with-btn">
                    <h3>一致性检查（挑跑样镜头）</h3>
                    <div class="row-actions">
                        <span class="tag" v-if="refs.length">参考图 {{ refs.length }} 张</span>
                        <input class="input-field" type="number" v-model="threshold" style="width:80px;" title="低于此分视为跑样">
                        <button class="btn-primary" @click="runCheck()">开始检查</button>
                    </div>
                </div>
                <div v-if="consistency">
                    <p class="hint">阈值 {{ consistency.threshold }}，疑似跑样：{{ consistency.suspects.length ? consistency.suspects.join('、') : '无' }}</p>
                    <div class="table-wrap" style="margin-top: 0.8rem;">
                        <table>
                            <thead><tr><th>镜头</th><th>分数</th><th>差异</th><th class="col-actions">结论</th></tr></thead>
                            <tbody>
                                <tr v-for="item in consistency.results" :key="item.shot_id">
                                    <td>{{ item.shot_id }}</td>
                                    <td>{{ item.score }}</td>
                                    <td>{{ item.diff }}</td>
                                    <td><span class="tag" :style="item.ok ? '' : 'color:#ff5c5c'">{{ item.ok ? '通过' : '待重绘' }}</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="hint">待重绘的镜头：到「提示词槽位」微调该镜头的描述，再在「工作流」里只重跑关键帧节点（其余镜头命中缓存不额外花钱）。</p>
                </div>
                <p class="hint" v-else>
                    {{ refs.length ? '每张比对约 0.002 元。' : '还没有绑定角色参考图，先到「角色参考图」里选。' }}
                </p>
            </div>
        </div>
    `
});
