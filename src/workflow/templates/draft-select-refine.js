'use strict';

/**
 * 三段式模板：草稿（便宜铺量）→ 人工选方向 → 精修（贵但值得）。
 */
module.exports = {
    id: 'draft-select-refine',
    name: '草稿筛选 → 精修',
    description: '关键帧变体铺量（全镜头 × 3 方向，约 0.02 元/张）→ 人工选方向 → 图生视频精修 → 合成',
    builtin: true,
    nodes: [
        { id: 'brief', stage: 'pre', enabled: true },
        { id: 'script', stage: 'pre', enabled: true },
        { id: 'storyboard', stage: 'pre', enabled: true },
        { id: 'prompt_assembly', stage: 'pre', enabled: true },
        { id: 'image_source', stage: 'pre', enabled: true, params: { mode: 'auto' } },
        // shots: 0 表示覆盖全部镜头。覆盖不全时，落选镜头没有关键帧，合成会直接报错。
        { id: 'variants', stage: 'pre', enabled: true, params: { shots: 0 } },
        { id: 'gate', stage: 'render', enabled: true },
        { id: 'shot_video', stage: 'render', enabled: true, params: { mode: 'std', duration: 3, limit: 3 } },
        { id: 'voice', stage: 'render', enabled: true },
        { id: 'compose', stage: 'render', enabled: true }
    ]
};
