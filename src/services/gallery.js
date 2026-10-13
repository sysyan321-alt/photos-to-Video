'use strict';

const fs = require('fs');
const path = require('path');
const ffmpeg = require('./ffmpeg');
const { createLogger } = require('../logger');
const {
    normalizeAlbum, normalizePhoto, normalizeExt, emptyIndex, decorateAlbums, pickPhotos
} = require('../domain/gallery');

const log = createLogger('gallery');

/**
 * 相册服务：文件落 data/comicdrama/gallery/，索引落 index.json。
 * 上传走原始二进制（前端直接发文件体），避免引入 multipart 依赖。
 */
function createGalleryService({ storage }) {
    const root = path.join(storage.root, 'gallery');
    fs.mkdirSync(root, { recursive: true });
    const indexFile = path.join(root, 'index.json');

    function readIndex() {
        return storage.readJson(indexFile, null) || emptyIndex();
    }

    function writeIndex(index) {
        storage.writeJson(indexFile, index);
        return index;
    }

    function albumDir(albumId) {
        return path.join(root, albumId);
    }

    const listAlbums = () => decorateAlbums(readIndex());

    const getAlbum = albumId => readIndex().albums.find(album => album.id === albumId) || null;

    function createAlbum(payload) {
        const index = readIndex();
        const album = normalizeAlbum(payload);
        index.albums.push(album);
        writeIndex(index);
        fs.mkdirSync(path.join(albumDir(album.id), 'thumbs'), { recursive: true });
        log.info(`相册创建: ${album.id} ${album.name}`);
        return album;
    }

    function deleteAlbum(albumId) {
        const index = readIndex();
        if (!index.albums.some(album => album.id === albumId)) return false;
        index.albums = index.albums.filter(album => album.id !== albumId);
        index.photos = index.photos.filter(photo => photo.albumId !== albumId);
        writeIndex(index);
        const dir = path.resolve(albumDir(albumId));
        if (dir.startsWith(root + path.sep)) fs.rmSync(dir, { recursive: true, force: true });
        return true;
    }

    function photosOf(albumId) {
        return readIndex().photos
            .filter(photo => photo.albumId === albumId)
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }

    /** 入库一张照片：原图 + 缩略图 + 尺寸探测 */
    async function addPhoto({ albumId, name, buffer, note, tags, source }) {
        const index = readIndex();
        const album = index.albums.find(item => item.id === albumId);
        if (!album) throw new Error('相册不存在');
        if (!buffer?.length) throw new Error('照片内容为空');

        const photo = normalizePhoto({ albumId, name, note, tags, source: source || 'upload' });
        const dir = albumDir(albumId);
        fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
        const file = path.join(dir, `${photo.id}.${normalizeExt(name)}`);
        fs.writeFileSync(file, buffer);

        let width = null;
        let height = null;
        try {
            const probe = await ffmpeg.ffprobe(file);
            width = probe.width;
            height = probe.height;
        } catch (error) {
            log.warn(`照片尺寸探测失败: ${error.message}`);
        }

        let thumb = null;
        try {
            thumb = await ffmpeg.renderThumbnail(file, path.join(dir, 'thumbs', `${photo.id}.jpg`), 360);
        } catch (error) {
            log.warn(`缩略图生成失败: ${error.message}`);
        }

        const record = { ...photo, file, thumb, width, height, bytes: buffer.length };
        index.photos.push(record);
        album.updatedAt = new Date().toISOString();
        if (!album.coverPhotoId) album.coverPhotoId = record.id;
        writeIndex(index);
        log.info(`照片入库: ${record.id} (${buffer.length} bytes) → ${albumId}`);
        return record;
    }

    function updatePhoto(photoId, patch = {}) {
        const index = readIndex();
        const photo = index.photos.find(item => item.id === photoId);
        if (!photo) return null;
        if (patch.note !== undefined) photo.note = String(patch.note).slice(0, 120);
        if (patch.tags !== undefined) photo.tags = normalizePhoto({ tags: patch.tags }).tags;
        if (patch.name !== undefined) photo.name = String(patch.name).slice(0, 60);
        // 智能选图的分数与理由也回写到照片记录里，出片时"按分数优先"才有依据
        if (patch.score !== undefined) photo.score = Number(patch.score) || 0;
        if (patch.reason !== undefined) photo.reason = String(patch.reason).slice(0, 60);
        if (patch.scoredAt !== undefined) photo.scoredAt = patch.scoredAt;
        writeIndex(index);
        return photo;
    }

    function deletePhoto(photoId) {
        const index = readIndex();
        const photo = index.photos.find(item => item.id === photoId);
        if (!photo) return false;
        index.photos = index.photos.filter(item => item.id !== photoId);
        for (const album of index.albums) {
            if (album.coverPhotoId === photoId) album.coverPhotoId = null;
        }
        writeIndex(index);
        for (const file of [photo.file, photo.thumb]) {
            if (file && path.resolve(file).startsWith(root + path.sep)) {
                try {
                    fs.rmSync(file, { force: true });
                } catch (error) {
                    log.warn(`删除文件失败: ${file}`);
                }
            }
        }
        return true;
    }

    return {
        root,
        listAlbums,
        getAlbum,
        createAlbum,
        deleteAlbum,
        photosOf,
        addPhoto,
        updatePhoto,
        deletePhoto,
        pickPhotos
    };
}

module.exports = { createGalleryService };
