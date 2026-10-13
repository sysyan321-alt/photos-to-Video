'use strict';

/**
 * 内置模板：相册 MV 15 秒。
 * 完全不需要模型 Key：照片 → Ken Burns 运镜片段 → 音轨 → 竖屏成片。
 */
module.exports = {
    id: 'album-mv-15s',
    name: '相册 MV 15 秒',
    description: '我的相册 → 运镜片段 + 音轨 → 15 秒竖屏成片（无需模型）',
    builtin: true,
    nodes: [
        { id: 'album_mv', stage: 'render', enabled: true, params: { albumId: null, pick: 'sequential', caption: 'note' } },
        { id: 'voice', stage: 'render', enabled: true },
        // 想让照片真的动起来就打开它（会调用视频模型，按镜头计费）
        { id: 'shot_video', stage: 'render', enabled: false, params: { mode: 'std', duration: 3, limit: 5 } },
        { id: 'compose', stage: 'render', enabled: true, params: { subtitle: true } }
    ]
};
