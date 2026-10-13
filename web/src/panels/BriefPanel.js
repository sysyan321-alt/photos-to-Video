import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

export default defineComponent({
    name: 'BriefPanel',
    data() {
        return { state };
    },
    computed: {
        brief() {
            return state.project?.brief || null;
        },
        meta() {
            if (!this.brief) return '';
            const source = this.brief.source === 'llm' ? '模型解析' : '规则解析';
            return `${source} · ${this.brief.shots} 镜头 / ${this.brief.duration}s · id ${this.brief.id}`;
        }
    },
    methods: {
        ...actions,
        save() {
            if (!this.brief) return;
            this.saveBriefEdits({
                ...this.brief,
                title: this.$refs.title.value.trim(),
                genre: this.$refs.genre.value.trim(),
                tone: this.$refs.tone.value.trim(),
                audience: this.$refs.audience.value.trim(),
                raw: this.$refs.raw.value.trim(),
                hook: this.$refs.hook.value.trim(),
                keywords: this.$refs.keywords.value.split(/[、,，\s]+/).filter(Boolean)
            });
        },
        copyBriefJson() {
            this.copy(JSON.stringify(this.brief, null, 2), 'Brief JSON 已复制');
        },
        async reanalyze() {
            if (!this.brief) return;
            await this.analyzeIdea(this.brief.raw);
            if (state.create.brief) {
                await this.saveBriefEdits({ ...state.create.brief, id: this.brief.id, source: 'offline' });
                state.create.brief = null;
            }
        }
    },
    template: `
        <div class="card" v-if="brief">
            <div class="card-header-with-btn">
                <h3>创意简报 Brief</h3>
                <div class="row-actions">
                    <button class="btn-secondary" @click="reanalyze()">按创意原文重新解析</button>
                    <button class="btn-secondary" @click="regeneratePreproduction()">用此 Brief 重新生成剧本与分镜</button>
                    <button class="btn-primary" @click="save()">保存修改</button>
                </div>
            </div>

            <div class="brief-grid">
                <div class="field"><label>标题</label><input class="input-field" ref="title" :value="brief.title"></div>
                <div class="field"><label>题材</label><input class="input-field" ref="genre" :value="brief.genre"></div>
                <div class="field"><label>情绪基调</label><input class="input-field" ref="tone" :value="brief.tone"></div>
                <div class="field"><label>目标观众</label><input class="input-field" ref="audience" :value="brief.audience"></div>
            </div>
            <div class="field"><label>一句话创意</label><textarea class="input-field" rows="2" ref="raw">{{ brief.raw }}</textarea></div>
            <div class="field"><label>开场钩子</label><input class="input-field" ref="hook" :value="brief.hook"></div>
            <div class="field"><label>关键词（用 、 分隔）</label><input class="input-field" ref="keywords" :value="(brief.keywords || []).join('、')"></div>

            <div class="brief-footer">
                <span>{{ meta }}</span>
                <button class="copy-btn-small" @click="copyBriefJson()">复制 Brief JSON</button>
            </div>
        </div>
        <div class="card" v-else><p class="hint">该项目没有 Brief</p></div>
    `
});
