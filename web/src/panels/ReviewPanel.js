import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

const RISK_LABEL = { low: '低风险 · 可发布', medium: '中风险 · 建议修改', high: '高风险 · 不建议发布' };

/** 审核：内容安全 + 图文一致性（一次调用同时判两件事） */
export default defineComponent({
    name: 'ReviewPanel',
    data() {
        return { state };
    },
    computed: {
        review() {
            return state.project?.review || null;
        },
        keyframeCount() {
            return (state.project?.assets?.keyframes || []).filter(item => item?.path).length;
        }
    },
    methods: {
        ...actions,
        riskText() {
            return RISK_LABEL[this.review?.risk] || '未审核';
        }
    },
    template: `
        <div>
            <div class="card">
                <div class="card-header-with-btn">
                    <h3>审核（合规 + 图文一致性）</h3>
                    <div class="row-actions">
                        <span class="tag" v-if="review" :class="review.risk === 'high' ? 'status-failed' : (review.risk === 'low' ? 'status-completed' : 'status-rendering')">{{ riskText() }}</span>
                        <button class="btn-primary" :disabled="!keyframeCount" @click="runReview()">运行审核</button>
                    </div>
                </div>
                <p class="hint">
                    检查关键帧与字幕：内容安全（政治/暴力/色情/违法/未成年/侵权）+ 字幕是否文不对图。
                    一次调用约 0.005 元。当前可审 {{ keyframeCount }} 帧。
                </p>
            </div>

            <div class="card" v-if="review">
                <h3>审核结论 · {{ riskText() }}</h3>
                <p class="hint">审核时间 {{ new Date(review.checkedAt).toLocaleString('zh-CN') }} · 覆盖 {{ review.frames }} 帧</p>

                <div class="text-item">
                    <div class="text-item-header"><span class="text-label">发现的问题</span></div>
                    <div v-if="review.issues && review.issues.length">
                        <div class="text-content" v-for="(item, index) in review.issues" :key="'i' + index">· {{ item }}</div>
                    </div>
                    <div class="text-content" v-else>未发现问题</div>
                </div>

                <div class="text-item">
                    <div class="text-item-header"><span class="text-label">修改建议</span></div>
                    <div v-if="review.suggestions && review.suggestions.length">
                        <div class="text-content" v-for="(item, index) in review.suggestions" :key="'s' + index">· {{ item }}</div>
                    </div>
                    <div class="text-content" v-else>无</div>
                </div>

                <p class="hint">
                    按建议改字幕或补镜头后，到「提示词槽位」调整对应镜头、再在「工作流」里单跑关键帧节点即可（其余镜头命中缓存不花钱）。
                </p>
            </div>

            <div class="card" v-else>
                <p class="hint">还没有审核记录。点上面的「运行审核」跑一次。</p>
            </div>
        </div>
    `
});
