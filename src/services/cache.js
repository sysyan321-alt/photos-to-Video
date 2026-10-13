'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const log = createLogger('cache');

/**
 * 素材缓存：相同输入（提示词/provider/模型/参数）不再重复调用付费 API。
 * 键 = 内容哈希，落在 data/growalbum/cache/<kind>/<hash>.<ext>。
 */
function createCache(storage) {
    const root = path.join(storage.root, 'cache');
    fs.mkdirSync(root, { recursive: true });
    const keyOf = parts => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20);

    async function withCache({ kind, parts, ext, outPath }, producer) {
        const dir = path.join(root, kind);
        fs.mkdirSync(dir, { recursive: true });
        const cachePath = path.join(dir, `${keyOf(parts)}.${ext}`);

        if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.copyFileSync(cachePath, outPath);
            log.info(`缓存命中 ${kind}/${path.basename(cachePath)}`);
            return { cached: true, path: outPath };
        }

        const result = await producer();
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
            fs.copyFileSync(outPath, cachePath);
        }
        return { ...(result || {}), cached: false, path: outPath };
    }

    return { root, withCache, keyOf };
}

module.exports = { createCache };
