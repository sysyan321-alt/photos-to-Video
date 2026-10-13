'use strict';

/** 图片来源：决定每个镜头的画面从哪来（模型生成 / 我的相册 / 面板占位） */
module.exports = {
    id: 'image_source',
    label: '图片来源',
    stage: 'pre',
    requires: ['prompt@shot'],
    produces: ['image_source@shot'],
    providerKind: null,
    defaultEnabled: true,
    params: { mode: 'auto' }, // auto | model | album | panel
    async run(ctx) {
        const mode = ctx.params.mode || 'auto';
        const imageProvider = ctx.providers.get('image');
        const resolved = mode === 'auto' ? (imageProvider.enabled ? 'model' : 'panel') : mode;

        if (resolved === 'album') {
            const albumId = ctx.params.albumId;
            if (!albumId) throw new Error('图片来源为相册时必须在节点参数里指定 albumId');
            const gallery = require('../../services/gallery').createGalleryService({ storage: ctx.storage });
            const album = gallery.getAlbum(albumId);
            if (!album) throw new Error(`相册不存在: ${albumId}`);
            const photos = gallery.photosOf(albumId);
            if (!photos.length) throw new Error('相册里还没有照片');

            // 选图策略：顺序 / 随机 / 按智能选图的分数优先
            const strategy = ctx.params.pick || 'sequential';
            const picked = [...photos];
            if (strategy === 'random') picked.sort(() => Math.random() - 0.5);
            let scoreWarning = null;
            if (strategy === 'score') {
                const scored = photos.filter(photo => photo.score !== undefined && photo.score !== null);
                const coverage = photos.length ? scored.length / photos.length : 0;
                picked.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
                if (coverage < 0.5) {
                    // 分数不够时明确警告，不再静默退化成"按顺序取图"
                    scoreWarning = `相册只有 ${scored.length}/${photos.length} 张打过分数，本次排序依据不足；建议先到「图片筛选」打分`;
                    ctx.log(`⚠ ${scoreWarning}`);
                }
            }

            ctx.project.shots.forEach((shot, index) => {
                const photo = picked[index % picked.length];
                shot.image_source = 'album';
                shot.photo_id = photo.id;
                shot.source_path = photo.file;
                shot.source_label = `相册 · ${photo.note || photo.name || photo.id}`;
            });
            return {
                detail: `${ctx.project.shots.length} 个镜头取自相册「${album.name}」（${strategy}，共 ${photos.length} 张可选）`
                    + (scoreWarning ? `；${scoreWarning}` : ''),
                warnings: scoreWarning ? [scoreWarning] : [],
                cost: { unit: 'yuan', credits: 0 }
            };
        }
        for (const shot of ctx.project.shots) shot.image_source = resolved;

        return {
            detail: resolved === 'model' ? '图像模型生成' : '面板占位（ffmpeg 渲染）',
            degraded: resolved === 'panel'
        };
    }
};
