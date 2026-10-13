import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import { state, actions } from '../store.js';

const MENU = [
    { key: 'create', label: '创作' },
    { key: 'projects', label: '作品' },
    { key: 'providers', label: '模型接入' },
    { key: 'analytics', label: '数据' }
];

/** 模型接入：四个环节各自选厂商、填凭据、测试连通、保存并热加载 */
export default defineComponent({
    name: 'ProvidersView',
    components: { NavBar },
    data() {
        return { state, menu: MENU, activeMenu: 'providers', forms: {}, testing: '', saved: '' };
    },
    computed: {
        providers() {
            return state.providerConfig || [];
        }
    },
    mounted() {
        actions.loadProviderConfig().then(() => {
            for (const item of this.providers) {
                this.forms[item.kind] = {
                    provider: item.provider,
                    apiKey: '', accessKey: '', secretKey: '',
                    baseUrl: '', model: '', size: '', resolution: '', voice: ''
                };
            }
        });
    },
    methods: {
        ...actions,
        onMenu(key) {
            if (key === 'create') state.view = 'home';
            if (key === 'projects') state.view = 'projects';
            if (key === 'analytics') state.view = 'analytics';
        },
        form(kind) {
            if (!this.forms[kind]) this.forms[kind] = { provider: '', apiKey: '', baseUrl: '', model: '' };
            return this.forms[kind];
        },
        async save(kind) {
            const payload = { kind, ...this.form(kind) };
            await this.saveProvider(payload);
            this.forms[kind].apiKey = '';
            this.forms[kind].accessKey = '';
            this.forms[kind].secretKey = '';
            this.saved = kind;
            setTimeout(() => { this.saved = ''; }, 2000);
        },
        async test(kind) {
            this.testing = kind;
            await this.testProvider(kind);
            this.testing = '';
        }
    },
    template: `
        <div class="container">
            <header class="home-header">
                <h1>模型接入<span class="sub">Providers</span></h1>
                <div class="header-actions">
                    <NavBar :items="menu" v-model="activeMenu" size="sm" align="end" @select="onMenu" />
                    <button class="btn-secondary" @click="state.view = 'home'">返回创作台</button>
                </div>
            </header>

            <p class="hint" style="margin-bottom: 1rem;">
                配置保存在 data/config/providers.json（优先于 env.yaml），保存后**立即生效、不用重启容器**。
                Key 只回传掩码，不落前端。
            </p>

            <section class="card" v-for="item in providers" :key="item.kind">
                <div class="card-header-with-btn">
                    <h3>{{ item.kindLabel }}
                        <span class="tag" :class="item.enabled ? 'status-completed' : 'status-failed'">{{ item.enabled ? '可用' : '未配置' }}</span>
                        <span class="tag" v-if="saved === item.kind">已保存并生效</span>
                    </h3>
                    <div class="row-actions">
                        <button class="btn-secondary" :disabled="testing === item.kind" @click="test(item.kind)">
                            {{ testing === item.kind ? '测试中…' : '测试连通' }}
                        </button>
                    </div>
                </div>

                <div class="brief-grid">
                    <div class="field">
                        <label>厂商</label>
                        <select class="input-field" v-model="form(item.kind).provider">
                            <option v-for="name in item.available" :key="name" :value="name">{{ name }}</option>
                        </select>
                    </div>
                    <div class="field">
                        <label>API Key {{ item.savedKeyMasked ? '（已存 ' + item.savedKeyMasked + '）' : '' }}</label>
                        <input class="input-field" v-model="form(item.kind).apiKey" placeholder="留空则不改动已保存的 Key">
                    </div>
                    <div class="field"><label>BaseURL</label><input class="input-field" v-model="form(item.kind).baseUrl" :placeholder="item.kind === 'llm' ? '如 https://api.deepseek.com/v1' : ''"></div>
                    <div class="field"><label>模型名</label><input class="input-field" v-model="form(item.kind).model" :placeholder="item.model || ''"></div>
                    <div class="field" v-if="item.kind === 'image'"><label>出图尺寸</label><input class="input-field" v-model="form(item.kind).size" placeholder="720*1280"></div>
                    <div class="field" v-if="item.kind === 'i2v'"><label>分辨率 / 尺寸</label><input class="input-field" v-model="form(item.kind).size" placeholder="540*960"></div>
                    <div class="field" v-if="item.kind === 'i2v'"><label>可灵 AccessKey</label><input class="input-field" v-model="form(item.kind).accessKey" placeholder="仅可灵需要"></div>
                    <div class="field" v-if="item.kind === 'i2v'"><label>可灵 SecretKey</label><input class="input-field" v-model="form(item.kind).secretKey" placeholder="仅可灵需要"></div>
                    <div class="field" v-if="item.kind === 'tts'"><label>音色</label><input class="input-field" v-model="form(item.kind).voice" placeholder="Cherry"></div>
                </div>

                <div class="row-actions">
                    <button class="btn-primary" @click="save(item.kind)">保存并热加载</button>
                    <span class="hint">当前：{{ item.provider }} / {{ item.model }}</span>
                </div>
            </section>
        </div>
    `
});
