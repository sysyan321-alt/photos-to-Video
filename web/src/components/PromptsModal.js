import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import Modal from './Modal.js';
import { state, actions } from '../store.js';

/**
 * 提示词库：按槽位分组管理（画风 / 一致性 / 运镜 / 光效 / 负面 / 音频情绪）。
 * 支持新增、编辑、启停、删除、导入导出 JSON。
 */
export default defineComponent({
    name: 'PromptsModal',
    components: { Modal },
    data() {
        return {
            state,
            form: { group: 'style', name: '', text: '', key: '', weight: 100, enabled: true },
            editingId: null,
            importText: '',
            showImport: false
        };
    },
    computed: {
        groups() {
            return state.presets.groups || [];
        }
    },
    methods: {
        ...actions,
        startEdit(preset) {
            this.editingId = preset.id;
            this.form = {
                group: preset.group,
                name: preset.name,
                text: preset.text,
                key: preset.key || '',
                weight: preset.weight,
                enabled: preset.enabled
            };
        },
        resetForm() {
            this.editingId = null;
            this.form = { group: 'style', name: '', text: '', key: '', weight: 100, enabled: true };
        },
        async submit() {
            if (!this.form.name.trim() || !this.form.text.trim()) {
                return this.notify('名称和文本都不能为空', 'error');
            }
            const payload = {
                group: this.form.group,
                name: this.form.name.trim(),
                text: this.form.text.trim(),
                key: this.form.key.trim() || undefined,
                weight: Number(this.form.weight) || 100,
                enabled: this.form.enabled
            };
            const ok = this.editingId
                ? await this.updatePreset(this.editingId, payload)
                : await this.createPreset(payload);
            if (ok) this.resetForm();
        },
        async toggle(preset) {
            await this.updatePreset(preset.id, { enabled: !preset.enabled });
        },
        async submitImport() {
            await this.importPresets(this.importText);
            this.importText = '';
            this.showImport = false;
        }
    },
    template: `
        <Modal :open="state.promptsOpen" title="提示词库（按槽位分组）" wide @close="state.promptsOpen = false">
            <div class="row-actions" style="margin-bottom: 1rem;">
                <button class="btn-secondary" @click="loadPresets()">刷新</button>
                <button class="btn-secondary" @click="exportPresets()">导出 JSON</button>
                <button class="btn-secondary" @click="showImport = !showImport">导入 JSON</button>
            </div>

            <div v-if="showImport" class="card" style="margin-bottom: 1rem;">
                <div class="field">
                    <label>粘贴预设 JSON</label>
                    <textarea class="input-field" rows="3" v-model="importText" placeholder='{"presets":[{"group":"style","name":"...","text":"..."}]}'></textarea>
                </div>
                <button class="btn-secondary" @click="submitImport()">导入</button>
            </div>

            <div class="card" style="margin-bottom: 1rem;">
                <h4>{{ editingId ? '编辑预设' : '新增预设' }}</h4>
                <div class="brief-grid" style="margin-top: 0.8rem;">
                    <div class="field">
                        <label>槽位分组</label>
                        <select class="input-field" v-model="form.group" :disabled="!!editingId">
                            <option v-for="group in groups" :key="group.slot" :value="group.slot">{{ group.label }}</option>
                        </select>
                    </div>
                    <div class="field"><label>名称</label><input class="input-field" v-model="form.name"></div>
                    <div class="field"><label>排序权重</label><input class="input-field" type="number" v-model="form.weight"></div>
                    <div class="field" v-if="form.group === 'camera'">
                        <label>对应运镜（自动匹配用）</label>
                        <input class="input-field" v-model="form.key" placeholder="缓慢推近 / 横向平移 / ...">
                    </div>
                </div>
                <div class="field"><label>提示词文本</label><textarea class="input-field" rows="2" v-model="form.text"></textarea></div>
                <div class="row-actions">
                    <button class="btn-primary" @click="submit()">{{ editingId ? '保存修改' : '加入提示词库' }}</button>
                    <button class="btn-secondary" v-if="editingId" @click="resetForm()">取消编辑</button>
                </div>
            </div>

            <div v-for="group in groups" :key="group.slot" class="card" style="margin-bottom: 0.8rem;">
                <h4>{{ group.label }}（{{ group.items.length }}）</h4>
                <div class="saved-prompts" style="margin-top: 0.7rem;">
                    <div class="saved-prompt" v-for="preset in group.items" :key="preset.id">
                        <div class="text-item-header">
                            <span class="text-label">
                                {{ preset.name }}
                                <span class="tag" v-if="preset.builtin">内置</span>
                                <span class="tag" v-if="!preset.enabled">已停用</span>
                                <span class="tag" v-if="preset.key">运镜={{ preset.key }}</span>
                            </span>
                            <span class="row-actions">
                                <button class="copy-btn-small" @click="copy(preset.text, '预设文本已复制')">复制</button>
                                <button class="copy-btn-small" @click="startEdit(preset)">编辑</button>
                                <button class="copy-btn-small" @click="toggle(preset)">{{ preset.enabled ? '停用' : '启用' }}</button>
                                <button class="btn-delete" v-if="!preset.builtin" @click="deletePreset(preset.id)">删除</button>
                            </span>
                        </div>
                        <div class="text-content">{{ preset.text }}</div>
                    </div>
                </div>
            </div>
        </Modal>
    `
});
