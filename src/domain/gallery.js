'use strict';

/**
 * 个人相册：Album（分组）+ Photo（照片）。
 * 相册既是素材源（首帧 / 参考图 / 直接当画面），也是产物沉淀池（AI 关键帧、封面可入库）。
 */

const crypto = require('crypto');

const PHOTO_SOURCES = ['upload', 'ai', 'keyframe', 'poster'];
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];

function newAlbumId() {
    return `alb_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
}

function newPhotoId() {
    return `pht_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function clampText(value, limit, fallback = '') {
    const chars = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim());
    if (!chars.length) return fallback;
    return chars.length <= limit ? chars.join('') : chars.slice(0, limit).join('');
}

function normalizeExt(name) {
    const parts = String(name || '').split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    if (ALLOWED_EXT.includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;
    return 'jpg';
}

function normalizeAlbum(input = {}) {
    return {
        id: String(input.id || newAlbumId()),
        name: clampText(input.name, 40, '未命名相册'),
        description: clampText(input.description, 200, ''),
        coverPhotoId: input.coverPhotoId || null,
        tags: Array.isArray(input.tags) ? input.tags.slice(0, 8).map(item => String(item).slice(0, 12)) : [],
        createdAt: input.createdAt || new Date().toISOString(),
        updatedAt: input.updatedAt || null
    };
}

function normalizePhoto(input = {}) {
    return {
        id: String(input.id || newPhotoId()),
        albumId: String(input.albumId || ''),
        file: input.file || null,
        thumb: input.thumb || null,
        name: clampText(input.name, 60, '照片'),
        width: Number.isFinite(Number(input.width)) ? Number(input.width) : null,
        height: Number.isFinite(Number(input.height)) ? Number(input.height) : null,
        bytes: Number.isFinite(Number(input.bytes)) ? Number(input.bytes) : null,
        source: PHOTO_SOURCES.includes(input.source) ? input.source : 'upload',
        tags: Array.isArray(input.tags) ? input.tags.slice(0, 8).map(item => String(item).slice(0, 12)) : [],
        note: clampText(input.note, 120, ''),
        createdAt: input.createdAt || new Date().toISOString()
    };
}

function emptyIndex() {
    return { version: 1, albums: [], photos: [] };
}

/** 相册列表带上照片数与封面（前端分组树用） */
function decorateAlbums(index) {
    return (index.albums || []).map(album => {
        const photos = (index.photos || []).filter(photo => photo.albumId === album.id);
        const cover = photos.find(photo => photo.id === album.coverPhotoId) || photos[0] || null;
        return {
            ...album,
            count: photos.length,
            cover: cover ? { id: cover.id, thumb: cover.thumb, file: cover.file } : null
        };
    }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 选图策略：顺序 / 随机 / 最新优先；数量不足时全用，超出时均匀抽样 */
function pickPhotos(photos, count, strategy = 'sequential') {
    const list = [...photos];
    if (strategy === 'random') {
        for (let i = list.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
    } else if (strategy === 'latest') {
        list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }
    if (!count || list.length <= count) return list;
    const step = list.length / count;
    return Array.from({ length: count }, (_, index) => list[Math.floor(index * step)]);
}

module.exports = {
    PHOTO_SOURCES,
    ALLOWED_EXT,
    newAlbumId,
    newPhotoId,
    normalizeAlbum,
    normalizePhoto,
    normalizeExt,
    emptyIndex,
    decorateAlbums,
    pickPhotos
};
