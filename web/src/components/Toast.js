import { defineComponent } from '/vendor/vue.esm-browser.prod.js';

export default defineComponent({
    name: 'Toast',
    props: {
        visible: { type: Boolean, default: false },
        text: { type: String, default: '' },
        type: { type: String, default: 'success' }
    },
    template: `
        <div class="notification" :class="[type, { show: visible }]">{{ text }}</div>
    `
});
