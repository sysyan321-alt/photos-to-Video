import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import Modal from './Modal.js';
import { fileUrl } from '../api.js';
import { state, actions } from '../store.js';

export default defineComponent({
    name: 'PreviewModal',
    components: { Modal },
    data() {
        return { state };
    },
    computed: {
        shot() {
            return state.preview.shot;
        },
        src() {
            if (!this.shot || !state.project) return '';
            const asset = (state.project.assets?.keyframes || []).find(item => item && item.shot_id === this.shot.shot_id);
            return asset?.path ? fileUrl(asset.path) : '';
        }
    },
    methods: {
        ...actions,
        close() {
            state.preview = { open: false, shot: null };
        }
    },
    template: `
        <Modal :open="state.preview.open" :title="shot ? shot.shot_id + ' · ' + shot.shot_size + ' / ' + shot.camera : '关键帧预览'" @close="close()">
            <img v-if="src" class="preview-image" :src="src" :alt="shot && shot.shot_id">
            <p class="hint" v-else>该项目还没有生成关键帧</p>
            <div class="text-item" style="margin-top: 1rem;" v-if="shot">
                <div class="text-item-header">
                    <span class="text-label">关键帧提示词</span>
                    <span class="row-actions">
                        <button class="copy-btn-small" @click="copy(shot.keyframe_prompt, '提示词已复制')">复制</button>
                        <button class="copy-btn-small" @click="addPrompt(shot.keyframe_prompt)">收藏</button>
                    </span>
                </div>
                <div class="text-content">{{ shot.keyframe_prompt }}</div>
                <div class="text-content" style="color: var(--text-secondary); font-size: 0.75rem; margin-top: 0.4rem;">
                    negative：{{ shot.negative_prompt }}
                </div>
            </div>
        </Modal>
    `
});
