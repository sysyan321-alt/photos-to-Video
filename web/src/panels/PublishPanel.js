import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

const PLATFORMS = ['抖音', '快手', 'B站', '通用'];

/** 发布：生成文案包 + 带 AI 标识的打标成片 */
export default defineComponent({
    name: 'PublishPanel',
    data() {
        return { state, platforms: PLATFORMS, platform: '抖音' };
    },
    computed: {
        pack() {
            return state.project?.publishPack || null;
        },
        outputs() {
            return state.project?.outputs || {};
        }
    },
    methods: {
        ...actions,
        async generate() {
            await this.publishProject(this.platform);
        },
        fullText() {
            const pack = this.pack;
            if (!pack) return '';
            return [
                `标题：${pack.titles.join(' / ')}`,
                `简介：${pack.intro}`,
                `封面文案：${pack.cover}`,
                `标签：${pack.tags.join(' ')}`,
                `AI 标识：${pack.aiDisclosure}`,
                `平台提示：${pack.platformTips}`
            ].join('\n');
        }
    },
    template: `
        <div>
            <div class="card">
                <div class="card-header-with-btn">
                    <h3>生成发布包</h3>
                    <div class="row-actions">
                        <select class="input-field" v-model="platform" style="width:auto;">
                            <option v-for="item in platforms" :key="item" :value="item">{{ item }}</option>
                        </select>
                        <button class="btn-primary" @click="generate()">生成</button>
                    </div>
                </div>
                <p class="hint">
                    会输出：3 个标题候选、简介、封面文案、10 个标签、AI 生成标识，
                    并把标识写进一版成片文件的元数据（不重编码、不掉画质）。
                </p>
                <div class="hint" v-if="!outputs.video">还没有成片，先生成视频再回来。</div>
            </div>

            <div class="card" v-if="pack">
                <div class="card-header-with-btn">
                    <h3>文案包 · {{ pack.platform }}</h3>
                    <button class="btn-secondary" @click="copy(fullText(), '整包文案已复制')">复制全部</button>
                </div>

                <div class="text-item" v-for="(title, index) in pack.titles" :key="'t' + index">
                    <div class="text-item-header">
                        <span class="text-label">标题候选 {{ index + 1 }}</span>
                        <button class="copy-btn-small" @click="copy(title, '标题已复制')">复制</button>
                    </div>
                    <div class="text-content">{{ title }}</div>
                </div>

                <div class="text-item">
                    <div class="text-item-header">
                        <span class="text-label">简介（{{ pack.intro.length }} 字）</span>
                        <button class="copy-btn-small" @click="copy(pack.intro, '简介已复制')">复制</button>
                    </div>
                    <div class="text-content">{{ pack.intro }}</div>
                </div>

                <div class="text-item">
                    <div class="text-item-header">
                        <span class="text-label">封面文案 · 标签</span>
                        <button class="copy-btn-small" @click="copy(pack.tags.join(' '), '标签已复制')">复制标签</button>
                    </div>
                    <div class="text-content">封面：{{ pack.cover }}</div>
                    <div class="row-actions" style="margin-top: 0.5rem;">
                        <span class="tag" v-for="tag in pack.tags" :key="tag">{{ tag }}</span>
                    </div>
                </div>

                <div class="text-item">
                    <div class="text-item-header"><span class="text-label">AI 生成标识</span></div>
                    <div class="text-content">{{ pack.aiDisclosure }}</div>
                </div>

                <div class="text-item">
                    <div class="text-item-header"><span class="text-label">平台提示</span></div>
                    <div class="text-content">{{ pack.platformTips }}</div>
                </div>

                <div class="row-actions" style="margin-top: 1rem;">
                    <a class="download" v-if="pack.stampedVideo" :href="fileUrl(pack.stampedVideo, true)">下载打标成片</a>
                    <a class="download" v-else-if="outputs.video" :href="'/api/projects/' + state.project.id + '/download'">下载原片</a>
                    <span class="hint" v-if="pack.stampError">打标失败：{{ pack.stampError }}</span>
                </div>
            </div>
        </div>
    `
});
