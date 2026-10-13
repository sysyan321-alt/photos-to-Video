import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { fileUrl } from '../api.js';
import { state, actions } from '../store.js';

export default defineComponent({
    name: 'AssetsPanel',
    data() {
        return { state };
    },
    computed: {
        items() {
            const project = state.project;
            if (!project) return [];
            const assets = project.assets?.keyframes || [];
            return (project.shots || []).map((shot, index) => ({
                shot,
                asset: assets.find(item => item && item.shot_id === shot.shot_id) || null,
                index
            }));
        }
    },
    methods: {
        ...actions,
        thumb(item) {
            return item.asset?.thumb ? fileUrl(item.asset.thumb) : (item.asset?.path ? fileUrl(item.asset.path) : '');
        },
        openPreview(item) {
            state.preview = { open: true, shot: item.shot };
        }
    },
    template: `
        <div v-if="state.project">
            <div class="toolbar">
                <span>关键帧由美术 Agent 按镜头提示词生成；未配置图像模型时是 ffmpeg 渲染的漫画分镜面板占位。</span>
            </div>
            <div class="asset-grid">
                <div class="asset-card" v-for="item in items" :key="item.shot.shot_id">
                    <img v-if="thumb(item)" class="asset-thumb" :src="thumb(item)" :alt="item.shot.shot_id" @click="openPreview(item)">
                    <div v-else class="asset-empty">尚未生成<br>渲染后出现在这里</div>
                    <div class="asset-body">
                        <div class="asset-title">
                            <span>{{ item.shot.shot_id }} · {{ item.shot.shot_size }}</span>
                            <span class="tag" v-if="item.asset">{{ item.asset.source === 'model' ? '模型出图' : '面板占位' }}</span>
                        </div>
                        <div class="asset-prompt">{{ item.shot.keyframe_prompt }}</div>
                        <div class="asset-actions">
                            <button class="copy-btn-small" @click="copy(item.shot.keyframe_prompt, '提示词已复制')">复制提示词</button>
                            <button class="copy-btn-small" @click="addPrompt(item.shot.keyframe_prompt)">收藏</button>
                            <button class="copy-btn-small" v-if="thumb(item)" @click="openPreview(item)">预览</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `
});
