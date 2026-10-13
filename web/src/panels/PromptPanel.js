import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import Modal from '../components/Modal.js';
import { state, actions } from '../store.js';

/**
 * 提示词槽位面板：
 * - 项目级：从菜单栏的提示词库里按槽位勾选，组装规则对全部镜头生效
 * - 镜头级：单个镜头可以覆盖（比如只有这个镜头要水墨风）
 * - 展示每个镜头组装后的最终提示词（可复现：同时记录用了哪些预设）
 */
export default defineComponent({
    name: 'PromptPanel',
    components: { Modal },
    data() {
        return { state, editingShot: null, shotDraft: {} };
    },
    computed: {
        node() {
            return (state.project?.workflow?.nodes || []).find(item => item.id === 'prompt_assembly') || null;
        },
        groups() {
            return (state.presets.groups || []).filter(group => group.slot !== 'scene');
        },
        slots() {
            return this.node?.params?.slots || {};
        },
        extraText() {
            return this.node?.params?.slots?.extraText || '';
        },
        shots() {
            return state.project?.shots || [];
        },
        presetMap() {
            const map = {};
            for (const preset of state.presets.presets || []) map[preset.id] = preset;
            return map;
        }
    },
    mounted() {
        if (!state.presets.presets.length) actions.loadPresets();
    },
    methods: {
        ...actions,
        presetName(id) {
            return this.presetMap[id]?.name || id;
        },
        isSelected(slot, id) {
            return (this.slots[slot] || []).includes(id);
        },
        async toggleSlot(slot, id) {
            const current = new Set(this.slots[slot] || []);
            if (current.has(id)) current.delete(id);
            else current.add(id);
            await this.setNodeParams('prompt_assembly', { slots: { [slot]: [...current] } });
        },
        async saveExtra(value) {
            await this.setNodeParams('prompt_assembly', { slots: { extraText: String(value || '') } });
        },
        openShotEditor(shot) {
            this.editingShot = shot;
            this.shotDraft = {
                style: [...(shot.prompt_slots?.style || this.slots.style || [])],
                lighting: [...(shot.prompt_slots?.lighting || this.slots.lighting || [])],
                negative: [...(shot.prompt_slots?.negative || this.slots.negative || [])]
            };
        },
        isShotSelected(slot, id) {
            return (this.shotDraft[slot] || []).includes(id);
        },
        toggleShotSlot(slot, id) {
            const list = new Set(this.shotDraft[slot] || []);
            if (list.has(id)) list.delete(id);
            else list.add(id);
            this.shotDraft = { ...this.shotDraft, [slot]: [...list] };
        },
        async saveShotOverride() {
            if (!this.editingShot) return;
            const target = this.editingShot;
            this.editingShot = null;
            await this.updateShot(target.shot_id, { prompt_slots: this.shotDraft });
        },
        async resetShot(shot) {
            await this.updateShot(shot.shot_id, { reset_slots: true });
        },
        groupsForShot() {
            return this.groups.filter(group => ['style', 'lighting', 'negative'].includes(group.slot));
        }
    },
    template: `
        <div>
            <div class="card">
                <div class="card-header-with-btn">
                    <h3>项目级槽位（来自提示词库菜单）</h3>
                    <div class="row-actions">
                        <button class="btn-secondary" @click="state.promptsOpen = true">打开提示词库</button>
                        <button class="btn-secondary" @click="loadPresets()">刷新预设</button>
                        <button class="btn-primary" @click="rerunNode('prompt_assembly')">按当前槽位重新组装</button>
                    </div>
                </div>

                <div class="slot-grid">
                    <div class="slot-block" v-for="group in groups" :key="group.slot">
                        <div class="slot-title">{{ group.label }}</div>
                        <label class="slot-item" v-for="preset in group.items" :key="preset.id"
                               :class="{ disabled: !preset.enabled }">
                            <input type="checkbox" class="mark-checkbox"
                                   :checked="isSelected(group.slot, preset.id)"
                                   :disabled="!preset.enabled"
                                   @change="toggleSlot(group.slot, preset.id)">
                            <span>{{ preset.name }}</span>
                        </label>
                    </div>
                </div>

                <div class="field" style="margin-top: 1rem;">
                    <label>补充文本（追加到每个镜头的 extra 槽位）</label>
                    <input class="input-field" :value="extraText" @change="saveExtra($event.target.value)"
                           placeholder="例如：构图留白多、避免复杂背景">
                </div>
                <p class="hint">
                    运镜槽位按分镜的运镜名自动匹配预设；改完槽位后点「重新组装」才会重算提示词。
                </p>
            </div>

            <div class="card">
                <h3>镜头级覆盖与组装结果</h3>
                <div class="table-wrap" style="margin-top: 1rem;">
                    <table>
                        <thead>
                            <tr>
                                <th>镜号</th>
                                <th>槽位来源</th>
                                <th>组装后的最终提示词</th>
                                <th class="col-actions">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="shot in shots" :key="shot.shot_id">
                                <td>{{ shot.shot_id }}<br><span class="hint">{{ shot.shot_size }} / {{ shot.camera }}</span></td>
                                <td>
                                    <span class="tag" v-if="!shot.prompt_slots">跟随项目</span>
                                    <template v-else>
                                        <span class="tag" v-for="id in (shot.prompt_slots.style || [])" :key="'s' + id">画风 · {{ presetName(id) }}</span>
                                        <span class="tag" v-for="id in (shot.prompt_slots.lighting || [])" :key="'l' + id">光效 · {{ presetName(id) }}</span>
                                        <span class="tag" v-for="id in (shot.prompt_slots.negative || [])" :key="'n' + id">负面 · {{ presetName(id) }}</span>
                                    </template>
                                </td>
                                <td><div class="prompt-preview">{{ shot.resolved_prompt }}</div></td>
                                <td>
                                    <div class="row-actions">
                                        <button class="copy-btn-small" @click="copy(shot.resolved_prompt, '组装结果已复制')">复制</button>
                                        <button class="copy-btn-small" @click="openShotEditor(shot)">覆盖</button>
                                        <button class="copy-btn-small" v-if="shot.prompt_slots" @click="resetShot(shot)">重置</button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal :open="!!editingShot" :title="editingShot ? editingShot.shot_id + ' 槽位覆盖' : ''" @close="editingShot = null">
                <div class="slot-block" v-for="group in groupsForShot()" :key="group.slot">
                    <div class="slot-title">{{ group.label }}</div>
                    <label class="slot-item" v-for="preset in group.items" :key="preset.id">
                        <input type="checkbox" class="mark-checkbox"
                               :checked="isShotSelected(group.slot, preset.id)"
                               :disabled="!preset.enabled"
                               @change="toggleShotSlot(group.slot, preset.id)">
                        <span>{{ preset.name }}</span>
                    </label>
                </div>
                <p class="hint">留空即跟随项目级设置；保存后点「按当前槽位重新组装」生效。</p>
                <template #footer>
                    <button class="btn-secondary" @click="editingShot = null">取消</button>
                    <button class="btn-primary" @click="saveShotOverride()">保存覆盖</button>
                </template>
            </Modal>
        </div>
    `
});
