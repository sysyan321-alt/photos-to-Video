import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

/** 方向对比：同一镜头横向并排，点「选定」后关键帧替换为该方向 */
export default defineComponent({
    name: 'VariantsPanel',
    data() {
        return { state };
    },
    computed: {
        variants() {
            return state.project?.variants || [];
        },
        shotIds() {
            return [...new Set(this.variants.flatMap(item => (item.shots || []).map(s => s.shot_id)))];
        },
        selected() {
            return state.project?.selectedVariant || null;
        }
    },
    methods: {
        ...actions,
        pathOf(variant, shotId) {
            return (variant.shots.find(item => item.shot_id === shotId) || {}).path;
        },
        captionOf(shotId) {
            return (state.project?.shots || []).find(item => item.shot_id === shotId)?.caption || '';
        }
    },
    template: `
        <div class="card" v-if="variants.length">
            <div class="card-header-with-btn">
                <h3>方向对比（选定后再精修）</h3>
                <span class="tag">{{ selected ? '已选定 ' + selected : '尚未选定' }}</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>镜头</th>
                            <th v-for="variant in variants" :key="variant.id">{{ variant.name }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="shotId in shotIds" :key="shotId">
                            <td>{{ shotId }}<br><span class="hint">{{ captionOf(shotId) }}</span></td>
                            <td v-for="variant in variants" :key="variant.id">
                                <img v-if="pathOf(variant, shotId)" class="variant-thumb" :src="fileUrl(pathOf(variant, shotId))" :alt="variant.name">
                                <span v-else class="hint">—</span>
                            </td>
                        </tr>
                        <tr>
                            <td>操作</td>
                            <td v-for="variant in variants" :key="variant.id">
                                <button class="btn-primary" v-if="selected !== variant.id" @click="selectVariant(variant.id)">选定{{ variant.name }}</button>
                                <span class="tag" v-else>当前方向</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="hint" v-if="!selected">选定后关键帧会替换为该方向，继续渲染即走 i2v 精修。</p>
            <div class="row-actions" style="margin-top: 0.8rem;" v-else>
                <span class="hint" style="margin: 0;">已选定 {{ selected }}，关键帧已替换为该方向。</span>
                <button class="btn-primary" @click="startRender()">接着渲染（i2v 精修 + 合成）</button>
            </div>
        </div>
        <div class="card" v-else><p class="hint">还没有变体。请用「草稿筛选 → 精修」模板创建项目。</p></div>
    `
});
