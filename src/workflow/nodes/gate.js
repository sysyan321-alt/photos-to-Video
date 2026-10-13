'use strict';

/**
 * ② 筛选阶段：人工选择闸门。跑到这里暂停（项目状态 awaiting_selection），
 * 你在「变体对比」里选定方向后再继续 —— 对应文档里「关键节点必须暂停等确认」。
 */
module.exports = {
    id: 'gate',
    label: '人工选方向',
    stage: 'render',
    requires: [],
    produces: [],
    providerKind: null,
    defaultEnabled: false,
    params: {},
    async run(ctx) {
        if (!ctx.project.variants?.length) throw new Error('没有可用变体，请先运行「关键帧变体」节点');
        if (!ctx.project.selectedVariant) {
            ctx.project.status = 'awaiting_selection';
            ctx.storage.saveProject(ctx.project);
            return { pause: true, detail: `已生成 ${ctx.project.variants.length} 个方向，等待选择` };
        }
        const selected = ctx.project.variants.find(item => item.id === ctx.project.selectedVariant);
        return { detail: `已选定方向 ${ctx.project.selectedVariant}${selected ? `（${selected.name}）` : ''}` };
    }
};
