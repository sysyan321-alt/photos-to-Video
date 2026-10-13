'use strict';

const { createLogger } = require('../logger');

const log = createLogger('retry');

// 限流 / 网关抖动 / 超时：这些值得重试；参数错误之类的重试也没用
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function statusOf(error) {
    const match = /HTTP (\d{3})/.exec(error?.message || '');
    return match ? Number(match[1]) : null;
}

function isRetryable(error) {
    const status = statusOf(error);
    if (status) return RETRYABLE_STATUS.has(status);
    return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|aborted/i.test(error?.message || '');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 指数退避重试。下游模型（百炼 Qwen-Image / Vidu）在并发铺量时会返回 429，
 * 没有重试的话整条节点链会因为一次限流直接失败。
 */
async function withRetry(fn, { retries = 4, baseDelayMs = 1200, label = '请求' } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error;
            if (attempt === retries || !isRetryable(error)) throw error;
            const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 400);
            log.warn(`${label} 失败（${error.message}），等待 ${delay}ms 后重试（第 ${attempt + 1}/${retries} 次）`);
            await sleep(delay);
        }
    }
    throw lastError;
}

module.exports = { withRetry, isRetryable };
