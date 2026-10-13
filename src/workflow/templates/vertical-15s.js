'use strict';

/**
 * 内置模板：竖屏短片 15 秒。
 * 流程顺序由模板声明；M4 的工作流编辑器改的就是这个结构（增删/排序/启停/改参）。
 */
module.exports = {
    id: 'vertical-15s',
    name: '竖屏短片 15 秒',
    description: '创意 → 剧本 → 分镜 → 提示词 → 关键帧 → (i2v) → 配音 → 合成',
    builtin: true,
    nodes: [
        { id: 'brief', stage: 'pre', enabled: true },
        { id: 'script', stage: 'pre', enabled: true },
        { id: 'storyboard', stage: 'pre', enabled: true },
        { id: 'prompt_assembly', stage: 'pre', enabled: true },
        { id: 'image_source', stage: 'pre', enabled: true, params: { mode: 'auto' } },
        { id: 'keyframe', stage: 'render', enabled: true },
        // i2v 打开后每个镜头都会调用一次视频模型；params.limit 可限制本次生成数量以压成本。
        // 百炼 Vidu 的入参契约已确认跑通（见 docs/WORKFLOW-PLAN.md 第 11 节）；默认关闭纯粹是成本考虑：
        // 计费约 0.375 元/秒，全片开 i2v 会明显抬高单条成本。
        // 省钱档：只给前 3 个镜头出真动态（钩子 + 情绪高点），其余走真实关键帧 + 轻动态
        { id: 'shot_video', stage: 'render', enabled: false, params: { mode: 'std', duration: 3, limit: 3 } },
        { id: 'voice', stage: 'render', enabled: true },
        { id: 'album_mv', stage: 'render', enabled: false },
        { id: 'compose', stage: 'render', enabled: true, params: { subtitle: true } },
        { id: 'review', stage: 'render', enabled: false }
    ]
};
