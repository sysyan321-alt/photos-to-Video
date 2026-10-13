import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

/**
 * 角色参考图：从相册里挑最多 3 张绑定到项目，
 * i2v 阶段作为 media[] 多图参考 —— 角色一致性的关键手段。
 */
export default defineComponent({
    name: 'RefsPanel',
    data() {
        return { state, picked: [], saved: false };
    },
    computed: {
        photos() {
            return state.allPhotos || [];
        },
        refs() {
            return state.project?.characterRefs || [];
        }
    },
    mounted() {
        actions.loadAllPhotos().then(() => {
            this.picked = this.refs.map(ref => ref.photoId);
        });
    },
    methods: {
        ...actions,
        toggle(photoId) {
            if (this.picked.includes(photoId)) {
                this.picked = this.picked.filter(id => id !== photoId);
                return;
            }
            if (this.picked.length >= 3) {
                this.notify('最多绑定 3 张参考图', 'error');
                return;
            }
            this.picked = [...this.picked, photoId];
        },
        async save() {
            await this.setCharacterRefs(this.picked);
            this.saved = true;
            setTimeout(() => { this.saved = false; }, 2000);
        }
    },
    template: `
        <div class="card">
            <div class="card-header-with-btn">
                <h3>角色参考图（最多 3 张）</h3>
                <div class="row-actions">
                    <span class="tag" v-if="saved">已保存</span>
                    <button class="btn-secondary" @click="state.view = 'gallery'">去相册上传</button>
                    <button class="btn-primary" @click="save()">绑定到项目</button>
                </div>
            </div>
            <p class="hint">选中的图会在 i2v 阶段作为参考图一起提交，让模型在不同镜头里保持同一张脸与同一套服装。</p>
            <div class="photo-grid" style="margin-top: 1rem;" v-if="photos.length">
                <div class="photo-card" v-for="photo in photos" :key="photo.id">
                    <img :src="fileUrl(photo.thumb || photo.file)" :alt="photo.id"
                         :style="picked.includes(photo.id) ? 'outline: 3px solid #ffffff;' : ''"
                         @click="toggle(photo.id)">
                    <div class="photo-body">
                        <div class="photo-meta">
                            <span class="tag">{{ picked.includes(photo.id) ? '已选为参考' : '点击选择' }}</span>
                            <button class="copy-btn-small" @click="reverseStyleFromPhoto(photo.id)">反推风格</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="asset-empty" v-else>相册里还没有照片，先去「我的相册」上传几张角色图</div>
        </div>
    `
});
