// 通用弹窗壳：标题 + 插槽 + 关闭，避免每个弹窗重复写遮罩逻辑

import { defineComponent } from '/vendor/vue.esm-browser.prod.js';

export default defineComponent({
    name: 'Modal',
    props: {
        open: { type: Boolean, default: false },
        title: { type: String, default: '' },
        wide: { type: Boolean, default: false }
    },
    emits: ['close'],
    template: `
        <div class="modal" :class="{ active: open }" @click.self="$emit('close')">
            <div class="modal-content" :class="{ wide }">
                <div class="modal-header">
                    <h3>{{ title }}</h3>
                    <button class="close-btn" @click="$emit('close')">×</button>
                </div>
                <div class="modal-body"><slot></slot></div>
                <div class="modal-footer" v-if="$slots.footer"><slot name="footer"></slot></div>
            </div>
        </div>
    `
});
