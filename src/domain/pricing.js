'use strict';

/**
 * 成本护栏：把节点花费换算成人民币并累计，超过预算就拒绝继续调用付费接口。
 * 价格表集中在这里，换模型只改一处。
 */

const PRICES = {
    image: { 'qwen-image-3.0': 0.02, 'qwen-image-2.1-turbo': 0.1, default: 0.02 },
    i2v: {
        'vidu/viduq3-pro-fast_img2video': { perSecond: 0.3125 },
        'vidu/viduq3-pro_img2video': { perSecond: 0.78125 },
        'vidu/viduq3-drama_reference2video': { perSecond: 0.875 },
        default: { perSecond: 0.3125 }
    },
    tts: { perCharacter: 0.00008 }
};

/** 预算（元）；0 或未设置表示不限制。用环境变量 COMIC_BUDGET_YUAN 配置 */
function budgetLimit() {
    const raw = Number(process.env.COMIC_BUDGET_YUAN);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function estimatePaidCall(kind, { model, seconds = 3 } = {}) {
    if (kind === 'image') {
        const table = PRICES.image;
        return table[model] ?? table.default;
    }
    if (kind === 'i2v') {
        const entry = PRICES.i2v[model] || PRICES.i2v.default;
        return entry.perSecond * Math.max(1, Number(seconds) || 3);
    }
    return 0;
}

/** 付款前检查：本次预估 + 已花费 是否超预算 */
function checkBudget({ spentYuan = 0, nextYuan = 0 } = {}) {
    const limit = budgetLimit();
    if (!limit) return { ok: true, limit: 0 };
    if (spentYuan + nextYuan > limit) {
        return {
            ok: false,
            limit,
            reason: `预算 ${limit} 元，已花 ${spentYuan.toFixed(3)} 元，本次约需 ${nextYuan.toFixed(3)} 元 —— 已中止`
        };
    }
    return { ok: true, limit };
}

/** 把节点返回的 cost（单位为元）累加进项目花费 */
function accumulate(spend, cost) {
    const total = Number(spend?.yuan) || 0;
    if (!cost || cost.unit !== 'yuan') return { yuan: total };
    return { yuan: Number((total + (Number(cost.credits) || 0)).toFixed(4)) };
}

module.exports = { PRICES, budgetLimit, estimatePaidCall, checkBudget, accumulate };
