'use strict';

const path = require('path');
const ffmpeg = require('../../services/ffmpeg');
const { createGalleryService } = require('../../services/gallery');
const { pickPhotos } = require('../../domain/gallery');
const { hashString } = require('../../agents/script');

const CAMERAS = ['缓慢推近', '横向平移', '缓慢拉远', '手持轻晃', '轻微上摇'];

/**
 * 相册 MV：把「我的相册」里的照片按选图策略变成镜头片段（Ken Burns 运镜 + 可选字幕）。
 * 产物写到 assets.shotVideos，合成节点会优先使用它们 —— 整条链路不需要图像/视频模型。
 */
module.exports = {
    id: 'album_mv',
    label: '相册 MV',
    stage: 'render',
    requires: [],
    produces: ['shots', 'clip@shot', 'keyframe@shot'],
    providerKind: null,
    defaultEnabled: false,
    params: { albumId: null, pick: 'sequential', caption: 'note' },
    async run(ctx) {
        const albumId = ctx.params.albumId;
        if (!albumId) throw new Error('相册 MV 需要指定 albumId');

        const gallery = createGalleryService({ storage: ctx.storage });
        const album = gallery.getAlbum(albumId);
        if (!album) throw new Error(`相册不存在: ${albumId}`);

        const all = gallery.photosOf(albumId);
        const strategy = ctx.params.pick || 'sequential';
        let photos;
        let scoreWarning = null;
        if (strategy === 'score') {
            // 与主链路统一：按 AI 打分排序取图；分数不足时明确警告，不静默退化
            const scored = all.filter(photo => photo.score !== undefined && photo.score !== null);
            if (scored.length / (all.length || 1) < 0.5) {
                scoreWarning = `相册只有 ${scored.length}/${all.length} 张打过分数，排序依据不足；建议先到「图片筛选」打分`;
                ctx.log(`⚠ ${scoreWarning}`);
            }
            photos = [...all].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, ctx.video.shots);
        } else {
            photos = pickPhotos(all, ctx.video.shots, strategy);
        }
        if (!photos.length) throw new Error('相册里还没有照片');

        const font = ffmpeg.findCjkFont();
        const seed = hashString(album.name || albumId);

        // 没有分镜时按选中的照片生成镜头；已有分镜则复用其节奏，只换画面来源
        const shots = photos.map((photo, index) => {
            const caption = ctx.params.caption === 'none' ? '' : (photo.note || '');
            const existing = ctx.project.shots[index];
            if (existing) {
                return {
                    ...existing,
                    image_source: 'album',
                    photo_id: photo.id,
                    caption: caption || existing.caption,
                    dialogue: caption || existing.dialogue
                };
            }
            return {
                shot_id: `ep1_s${String(index + 1).padStart(2, '0')}`,
                episode: 1,
                scene: index + 1,
                duration: ctx.video.shotSeconds,
                shot_size: '中景',
                camera: CAMERAS[(seed + index) % CAMERAS.length],
                visual_desc: `相册照片：${photo.name}`,
                characters: [],
                dialogue: caption,
                caption,
                narration: '',
                sfx: '',
                bgm: '环境铺底',
                motion: '轻动态（Ken Burns）',
                emotion: '',
                image_source: 'album',
                photo_id: photo.id,
                prompt_slots: null,
                resolved_prompt: null,
                preset_ids: [],
                palette: ['0x101820', '0x2f5d62'],
                panel_label: `PHOTO ${String(index + 1).padStart(2, '0')}`
            };
        });

        ctx.project.shots = shots;
        if (!ctx.project.name) ctx.project.name = album.name;

        const shotVideos = {};
        const keyframes = [];
        for (let index = 0; index < shots.length; index += 1) {
            const shot = shots[index];
            const photo = photos[index];
            const outPath = path.join(ctx.dirs.clips, `${shot.shot_id}.mp4`);
            await ffmpeg.renderClip({
                imagePath: photo.file,
                outPath,
                camera: shot.camera,
                caption: shot.caption,
                font,
                video: ctx.video,
                tempDir: ctx.dirs.temp,
                index: index + 1
            });
            shotVideos[shot.shot_id] = outPath;
            keyframes.push({ shot_id: shot.shot_id, path: photo.file, thumb: photo.thumb, source: 'album' });
            ctx.project.assets.shotVideos = shotVideos;
            ctx.project.assets.keyframes = keyframes;
            ctx.log(`相册片段 ${index + 1}/${shots.length} 完成`);
        }

        ctx.storage.saveProject(ctx.project);
        return {
            detail: `${shots.length} 张照片 → ${shots.length} 个镜头（${album.name}，${strategy}）`
                + (scoreWarning ? `；${scoreWarning}` : ''),
            warnings: scoreWarning ? [scoreWarning] : []
        };
    }
};
