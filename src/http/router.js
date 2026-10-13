'use strict';

const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.srt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8'
};

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

/** 支持 Range 的静态文件响应，<video> 才能拖动进度条 */
function sendFile(req, res, filePath, options = {}) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (error) {
        return sendJson(res, 404, { success: false, message: '文件不存在', path: filePath });
    }
    if (!stat.isFile()) return sendJson(res, 404, { success: false, message: '不是文件', path: filePath });

    const headers = {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
    };
    if (options.download) {
        headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    }

    const range = req.headers?.range;
    if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        let start = match && match[1] ? Number.parseInt(match[1], 10) : 0;
        let end = match && match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
        if (start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
            return res.end();
        }
        res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': end - start + 1
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    return fs.createReadStream(filePath).pipe(res);
}

function readJsonBody(req, limit = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > limit) {
                req.destroy();
                reject(new Error('请求体过大'));
            }
        });
        req.on('end', () => {
            if (!body.trim()) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error('请求体不是合法 JSON'));
            }
        });
        req.on('error', reject);
    });
}

function createRouter() {
    const routes = [];

    function add(method, pattern, handler) {
        routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
    }

    function match(method, pathname) {
        const parts = pathname.split('/').filter(Boolean);
        for (const route of routes) {
            if (route.method !== method || route.segments.length !== parts.length) continue;
            const params = {};
            let matched = true;
            for (let index = 0; index < parts.length; index += 1) {
                const segment = route.segments[index];
                if (segment.startsWith(':')) {
                    params[segment.slice(1)] = decodeURIComponent(parts[index]);
                } else if (segment !== parts[index]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return { handler: route.handler, params };
        }
        return null;
    }

    return {
        get: (pattern, handler) => add('GET', pattern, handler),
        post: (pattern, handler) => add('POST', pattern, handler),
        delete: (pattern, handler) => add('DELETE', pattern, handler),
        match,
        routes
    };
}

/** 读取原始二进制请求体（相册上传用，避免引入 multipart 依赖） */
function readRawBody(req, limit = 32 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > limit) {
                req.destroy();
                reject(new Error('上传内容过大（上限 32MB）'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

module.exports = { createRouter, sendJson, sendFile, readJsonBody, readRawBody, MIME_TYPES };
