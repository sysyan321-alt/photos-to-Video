import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import { state, actions } from '../store.js';

export default defineComponent({
    name: 'ShotsPanel',
    data() {
        return { state };
    },
    computed: {
        shots() {
            return state.project?.shots || [];
        },
        selectedShots() {
            return this.shots.filter(shot => state.selected[shot.shot_id]);
        },
        selectionText() {
            const total = this.shots.length;
            const count = this.selectedShots.length;
            return count ? `已选 ${count} / ${total} 个镜头` : `未选择镜头（共 ${total} 个）`;
        },
        allChecked() {
            return this.shots.length > 0 && this.selectedShots.length === this.shots.length;
        }
    },
    methods: {
        ...actions,
        copySelected(kind) {
            const list = this.selectedShots.length ? this.selectedShots : this.shots;
            const text = kind === 'captions'
                ? list.map(shot => `${shot.shot_id}｜${shot.caption}`).join('\n')
                : list.map(shot => `# ${shot.shot_id} ${shot.shot_size} / ${shot.camera}\n${shot.keyframe_prompt}`).join('\n\n');
            const label = kind === 'captions' ? '字幕' : '提示词';
            this.copy(text, `已复制 ${list.length} 条${label}`);
        },
        exportPrompts() {
            const list = this.selectedShots.length ? this.selectedShots : this.shots;
            const header = `# ${state.project.name} 关键帧提示词包\n# 题材：${state.project.brief?.genre || '-'}　基调：${state.project.brief?.tone || '-'}\n# 风格：${state.project.storyboard?.style?.keywords || '-'}\n\n`;
            const body = list.map(shot => [
                `## ${shot.shot_id}　${shot.shot_size} / ${shot.camera} / ${shot.duration}s / ${shot.emotion}`,
                `negative: ${shot.negative_prompt}`,
                '',
                shot.keyframe_prompt,
                ''
            ].join('\n')).join('\n');
            this.download(`${state.project.name || 'comicdrama'}_prompts.txt`, header + body);
            this.notify(`已导出 ${list.length} 条提示词`);
        }
    },
    template: `
        <div>
            <div class="toolbar">
                <span>{{ selectionText }}</span>
                <button class="btn-secondary" @click="copySelected('captions')">复制选中字幕</button>
                <button class="btn-secondary" @click="copySelected('prompts')">复制选中提示词</button>
                <button class="btn-secondary" @click="exportPrompts()">导出提示词包</button>
                <button class="btn-secondary" @click="clearSelection()" v-if="selectedShots.length">清空选择</button>
            </div>

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th class="col-check"><input type="checkbox" class="mark-checkbox" :checked="allChecked" @change="toggleAllShots($event.target.checked)"></th>
                            <th>镜号</th>
                            <th>景别 / 运镜</th>
                            <th>时长</th>
                            <th>字幕 / 台词</th>
                            <th>情绪</th>
                            <th class="col-actions">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="shot in shots" :key="shot.shot_id">
                            <td><input type="checkbox" class="mark-checkbox" :checked="!!state.selected[shot.shot_id]" @change="toggleShot(shot.shot_id, $event.target.checked)"></td>
                            <td>{{ shot.shot_id }}</td>
                            <td>{{ shot.shot_size }}<br><span style="color: var(--text-secondary); font-size: 0.72rem;">{{ shot.camera }}</span></td>
                            <td>{{ shot.duration }}s</td>
                            <td>{{ shot.caption }}</td>
                            <td>{{ shot.emotion }}</td>
                            <td>
                                <div class="row-actions">
                                    <button class="copy-btn-small" @click="copy(shot.caption, '字幕已复制')">字幕</button>
                                    <button class="copy-btn-small" @click="copy(shot.keyframe_prompt, '关键帧提示词已复制')">提示词</button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `
});
