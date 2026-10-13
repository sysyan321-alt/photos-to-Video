import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

export default defineComponent({
    name: 'ScriptPanel',
    data() {
        return { state, open: {} };
    },
    computed: {
        script() {
            return state.project?.script || null;
        }
    },
    mounted() {
        if (this.script?.beats?.length) this.open[this.script.beats[0].index] = true;
    },
    methods: {
        ...actions,
        toggle(index) {
            this.open[index] = !this.open[index];
        },
        copyAll() {
            const beats = this.script?.beats || [];
            const text = beats.map(beat => `【${beat.label}】${beat.caption}\n画面：${beat.action}`).join('\n\n');
            this.copy(text, '整段剧本已复制');
        },
        copyCharacters() {
            const text = (this.script?.characters || [])
                .map(character => `${character.name}（${character.role}）：${character.appearance}\n音色：${character.voice?.tone || '-'} / ${character.voice?.speed || '-'} / ${character.voice?.style || '-'}`)
                .join('\n\n');
            this.copy(text, '角色卡已复制');
        }
    },
    template: `
        <div v-if="script">
            <div class="card">
                <div class="card-header-with-btn">
                    <h3>剧本节拍</h3>
                    <div class="row-actions">
                        <span class="tag">{{ script.source === 'llm' ? '模型生成' : '模板生成' }}</span>
                        <button class="btn-secondary" @click="copyAll()">复制全部</button>
                    </div>
                </div>
                <div class="expandable-card" v-for="beat in script.beats" :key="beat.index" :class="{ open: open[beat.index] }">
                    <div class="expandable-header" @click="toggle(beat.index)">
                        <span class="expand-icon">▶</span>
                        <span class="expandable-title">{{ beat.index }}. {{ beat.label }} · {{ beat.caption }}</span>
                        <button class="copy-btn-small" @click.stop="copy(beat.caption, '台词已复制')">复制</button>
                    </div>
                    <div class="expandable-content">
                        <div class="text-item">
                            <div class="text-item-header"><span class="text-label">台词 / 字幕</span></div>
                            <div class="text-content">{{ beat.caption }}</div>
                        </div>
                        <div class="text-item">
                            <div class="text-item-header"><span class="text-label">画面动作</span></div>
                            <div class="text-content">{{ beat.action }}</div>
                        </div>
                        <div class="text-item">
                            <div class="text-item-header"><span class="text-label">情绪</span></div>
                            <div class="text-content">{{ beat.emotion }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header-with-btn">
                    <h3>角色卡</h3>
                    <button class="btn-secondary" @click="copyCharacters()">复制全部</button>
                </div>
                <div class="card-grid">
                    <div class="text-item" v-for="character in script.characters" :key="character.id">
                        <div class="text-item-header">
                            <span class="text-label">{{ character.id }} · {{ character.role }}</span>
                            <button class="copy-btn-small" @click="copy(character.reference_prompt || character.appearance, '角色提示词已复制')">复制提示词</button>
                        </div>
                        <div class="text-content">{{ character.name }}｜{{ character.appearance }}</div>
                        <div class="text-content" style="color: var(--text-secondary); font-size: 0.75rem;">
                            音色：{{ character.voice?.tone || '-' }} · {{ character.voice?.speed || '-' }} · {{ character.voice?.style || '-' }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="card" v-else><p class="hint">还没有剧本</p></div>
    `
});
