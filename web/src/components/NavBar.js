// ★ 独立菜单栏组件：只依赖 items / modelValue，可在任意页面复用
//   items: [{ key, label, badge?, disabled? }]

import { defineComponent } from '/vendor/vue.esm-browser.prod.js';

export default defineComponent({
    name: 'NavBar',
    props: {
        items: { type: Array, required: true },
        modelValue: { type: String, default: '' },
        align: { type: String, default: 'start' }, // start | end
        size: { type: String, default: 'md' }      // md | sm
    },
    emits: ['update:modelValue', 'select'],
    methods: {
        select(item) {
            if (item.disabled || item.key === this.modelValue) return;
            this.$emit('update:modelValue', item.key);
            this.$emit('select', item.key);
        }
    },
    template: `
        <nav class="navbar" :class="['align-' + align, 'size-' + size]">
            <button
                v-for="item in items"
                :key="item.key"
                class="navbar-item"
                :class="{ active: item.key === modelValue, disabled: item.disabled }"
                :disabled="!!item.disabled"
                :title="item.title || item.label"
                @click="select(item)"
            >
                <span class="navbar-label">{{ item.label }}</span>
                <span v-if="item.badge" class="navbar-badge">{{ item.badge }}</span>
            </button>
        </nav>
    `
});
