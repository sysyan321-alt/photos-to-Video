import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { fileUrl } from '../api.js';
import { state, actions } from '../store.js';

export default defineComponent({
    name: 'RenderPanel',
    data() {
        return { state };
    },
    computed: {
        job() {
            return state.job;
        },
        outputs() {
            return state.project?.outputs || {};
        },
        statusLabel() {
            if (!this.job) return state.project?.status === 'completed' ? '已完成' : '空闲';
            return {
                queued: '排队中',
                running: '渲染中',
                succeeded: '已完成',
                failed: '失败',
                awaiting_selection: '等待选方向'
            }[this.job.status] || this.job.status;
        },
        awaitingSelection() {
            return this.job?.status === 'awaiting_selection' || state.project?.status === 'awaiting_selection';
        },
        publishPack() {
            const project = state.project;
            if (!project) return null;
            const brief = project.brief || {};
            const script = project.script || {};
            const keywords = brief.keywords || [];
            const genre = brief.genre || script.genre || '短片';
            const titles = [
                brief.title || project.name,
                `${brief.title || project.name}｜${brief.hook ? brief.hook.slice(0, 10) : '反转来了'}`,
                `前3秒就上头：${brief.title || project.name}`
            ];
            const tags = [...new Set([
                genre, '短片', '动态漫', 'AI短片', '短剧',
                ...keywords,
                brief.tone ? `${brief.tone}` : '悬疑反转'
            ])].slice(0, 10);
            return {
                titles,
                intro: (script.logline || brief.logline || '').slice(0, 50),
                tags,
                cover: (brief.title || project.name || '').slice(0, 6)
            };
        }
    },
    methods: {
        ...actions,
        videoUrl() {
            return this.outputs.video ? fileUrl(this.outputs.video) : '';
        },
        copyPack() {
            const pack = this.publishPack;
            if (!pack) return;
            const text = [
                `标题候选：\n${pack.titles.map((title, index) => `${index + 1}. ${title}`).join('\n')}`,
                `简介（${pack.intro.length} 字）：${pack.intro}`,
                `封面文案：${pack.cover}`,
                `标签（${pack.tags.length}）：${pack.tags.join(' ')}`
            ].join('\n\n');
            this.copy(text, '发布包已复制');
        }
    },
    template: `
        <div class="card-grid" v-if="state.project">
            <div class="card card-error" v-if="awaitingSelection" style="grid-column: 1 / -1;">
                <h3>⏸ 渲染停在人工闸门</h3>
                <p class="hint">已生成多个风格方向，需先在「方向对比」里选定一个，再继续精修（i2v + 合成）。</p>
                <div class="row-actions" style="margin-top: 0.8rem;">
                    <button class="btn-primary" @click="state.tab = 'variants'">去选方向</button>
                </div>
            </div>
            <div class="card">
                <h3>渲染任务</h3>
                <div class="job-head" style="margin-top: 1rem;">
                    <span>{{ statusLabel }}</span>
                    <span>{{ (job && job.progress) || 0 }}%</span>
                </div>
                <div class="bar"><div id="jobBar" :style="{ width: ((job && job.progress) || 0) + '%' }"></div></div>
                <ol class="steps">
                    <li v-for="step in (job ? job.steps : [])" :key="step.name" :class="step.status">
                        {{ step.status === 'succeeded' ? '✔' : step.status === 'failed' ? '✘' : step.status === 'running' ? '▶' : '·' }}
                        {{ step.name }}<span v-if="step.detail"> — {{ step.detail }}</span>
                    </li>
                </ol>
                <pre class="log">{{ (job && job.logs ? job.logs : []).slice(-40).map(function (item) { return item.message; }).join('\\n') }}</pre>
            </div>

            <div class="card">
                <h3>成片</h3>
                <div class="stage" style="margin-top: 1rem;">
                    <video v-if="outputs.video" :src="videoUrl()" controls playsinline></video>
                    <div v-else class="hint">还没有成片，点右上角「渲染 15 秒成片」</div>
                </div>
                <div class="hint" v-if="outputs.video">
                    {{ outputs.resolution }} · {{ outputs.duration }}s · {{ (outputs.sizeBytes / 1024 / 1024).toFixed(2) }}MB · 音轨 {{ outputs.hasAudio ? '有' : '无' }}
                </div>
                <a class="download" v-if="outputs.video" :href="'/api/projects/' + state.project.id + '/download'">下载成片 MP4</a>
            </div>

            <div class="card">
                <div class="card-header-with-btn">
                    <h3>发布包（运营 Agent 规则版）</h3>
                    <button class="btn-secondary" @click="copyPack()">复制发布包</button>
                </div>
                <div class="brief-readonly" v-if="publishPack">
                    <div class="row"><em>标题候选</em><span>
                        <span v-for="(title, index) in publishPack.titles" :key="index">{{ index + 1 }}. {{ title }}<br></span>
                    </span></div>
                    <div class="row"><em>简介</em><span>{{ publishPack.intro }}</span></div>
                    <div class="row"><em>封面文案</em><span>{{ publishPack.cover }}</span></div>
                    <div class="row"><em>标签</em><span>{{ publishPack.tags.join('　') }}</span></div>
                </div>
            </div>
        </div>
    `
});
