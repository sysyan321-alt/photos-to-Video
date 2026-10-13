'use strict';

const { createLogger } = require('../logger');
const { normalizeBrief, toPromptText } = require('../domain/brief');

const log = createLogger('idea-agent');

/**
 * 创意 Agent：把一句话创意解析成结构化 Brief（题材 / 基调 / 钩子 / 关键词 / 标题）。
 * 这是全链路的第一道关卡，独立于项目存在——可以先解析、人工改，再决定要不要开项目。
 */

const SETTING_LEXICON = [
    '雨夜', '深夜', '黄昏', '清晨', '雪天', '旧楼', '电梯', '楼梯间', '走廊', '天台',
    '便利店', '咖啡馆', '地铁', '车站', '教室', '操场', '宿舍', '图书馆', '医院',
    '古宅', '老屋', '公寓', '胡同', '办公室', '实验室', '会议室', '停车场', '海边'
];

const GENRE_RULES = [
    { genre: '都市悬疑', words: ['死', '尸', '失踪', '真相', '秘密', '凶手', '血迹', '案', '诡异', '诡异', '电梯', '旧楼', '监控', '替身'] },
    { genre: '都市情感', words: ['喜欢', '告白', '分手', '重逢', '眼泪', '错过', '结婚', '前任', '暗恋', '婚'] },
    { genre: '玄幻热血', words: ['灵气', '宗门', '剑', '修炼', '妖兽', '仙', '魔', '符', '功法', '渡劫'] },
    { genre: '校园青春', words: ['教室', '同学', '高考', '校服', '毕业', '操场', '同桌', '班主任'] },
    { genre: '科幻未来', words: ['穿越', '时间', '机器人', '未来', '量子', '飞船', '实验', '复制', '记忆', '平行'] },
    { genre: '轻喜剧', words: ['搞笑', '尴尬', '社死', '老板', '外卖', '加班', '相亲', '房租', '室友'] }
];

const TONE_BY_GENRE = {
    '都市悬疑': '冷静克制，压抑',
    '都市情感': '细腻克制，留白',
    '玄幻热血': '高昂张扬，节奏快',
    '校园青春': '清新明亮，轻快',
    '科幻未来': '冷静疏离，理性',
    '轻喜剧': '轻快吐槽，口语化'
};

const HOOK_MARKER = /却|竟|居然|原来|并不|不是|已经死|消失|突然|偏偏|第二|反而|翻出|发现|收到/;
const VERB_CHARS = /[回到是在有看说走想要去来把被让给跟对过做能会就都还也很更最不没和与及或但而]/;

function clauseSplit(text) {
    return String(text || '')
        .split(/[。！？!?；;，,\n\r]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

/** 关键词：先命中场景词库，不足时再从句子里挑不含动词字的短语 */
function extractKeywords(idea) {
    const text = String(idea || '');
    const hits = [];
    for (const term of SETTING_LEXICON) {
        if (text.includes(term)) hits.push(term);
    }

    if (hits.length < 2) {
        // 不做字符切片 —— 那会切出「雨夜天」「后一封」这类残词。
        // 改为整句兜底：只收 2-8 字的完整短句。
        for (const clause of clauseSplit(text)) {
            const cleaned = clause.replace(/[，,、。！？!?；;\s]+/g, '');
            const size = Array.from(cleaned).length;
            if (size >= 2 && size <= 8 && !hits.includes(cleaned)) hits.push(cleaned);
        }
    }

    return [...new Set(hits)].slice(0, 6);
}

function inferGenre(idea) {
    let best = { genre: '都市悬疑', score: 0 };
    for (const rule of GENRE_RULES) {
        const score = rule.words.reduce((sum, word) => sum + (String(idea).includes(word) ? 1 : 0), 0);
        if (score > best.score) best = { genre: rule.genre, score };
    }
    return best.genre;
}

function pickHook(idea) {
    const clauses = clauseSplit(idea);
    const marked = clauses.find(clause => HOOK_MARKER.test(clause));
    return marked || clauses[clauses.length - 1] || String(idea || '');
}

/** 离线拟标题：短句直接用；长句优先用提炼出的关键词（如「便利店」），最后才硬截断 */
function deriveTitle(clauses, keywords = []) {
    const first = clauses[0] || '';
    const chars = Array.from(first);
    if (!chars.length) return '无声之夜';
    if (chars.length <= 8) return chars.join('');

    const keyword = keywords.find(word => {
        const size = Array.from(word).length;
        return size >= 2 && size <= 5 && !VERB_CHARS.test(word);
    });
    if (keyword) return keyword;
    return chars.slice(0, 6).join('');
}

/** 离线创意解析：规则化的题材/基调/钩子推断，保证没有模型也能得到 Brief */
function offlineBrief({ idea, title, video }) {
    const clauses = clauseSplit(idea);
    const genre = inferGenre(idea);
    const keywords = extractKeywords(idea);
    const scene = keywords.filter(word => SETTING_LEXICON.includes(word)).slice(0, 3);

    return normalizeBrief({
        raw: idea,
        title: title || deriveTitle(clauses, keywords),
        logline: clauses.slice(0, 2).join('，') || idea,
        genre,
        tone: TONE_BY_GENRE[genre] || '冷静克制',
        hook: pickHook(idea),
        audience: genre === '校园青春' ? '学生向短剧用户' : genre === '玄幻热血' ? '男性向爽文用户' : '短片泛用户',
        keywords: [...keywords, ...scene],
        source: 'offline'
    }, { video });
}

const SYSTEM_PROMPT = [
    '你是短片的选题策划（创意 Agent）。把用户的一句话创意解析成结构化创意简报。',
    '要求：',
    '- title 不超过 8 个字，要有钩子',
    '- logline 用一句话讲清冲突，不超过 40 字',
    '- genre 从这几个里选：都市悬疑 / 都市情感 / 玄幻热血 / 校园青春 / 科幻未来 / 轻喜剧',
    '- tone 描述情绪基调与画面质感',
    '- hook 是前 3 秒必须抓住人的那句话',
    '- keywords 给 3-6 个可用于画图的关键词',
    '- 只输出 JSON，不要解释',
    '',
    'JSON 结构：',
    '{"title":"","logline":"","genre":"","tone":"","hook":"","keywords":[""],"audience":""}'
].join('\n');

function fromModelJson(raw, { idea, title, video }) {
    const fallback = offlineBrief({ idea, title, video });
    return normalizeBrief({
        raw: idea,
        title: title || raw?.title || fallback.title,
        logline: raw?.logline || fallback.logline,
        genre: raw?.genre || fallback.genre,
        tone: raw?.tone || fallback.tone,
        hook: raw?.hook || fallback.hook,
        audience: raw?.audience || fallback.audience,
        keywords: raw?.keywords?.length ? raw.keywords : fallback.keywords,
        source: 'llm'
    }, { video });
}

async function buildBrief({ idea, title, video, llm }) {
    const text = String(idea || '').trim();
    if (llm.enabled) {
        try {
            const raw = await llm.generateJson({
                system: SYSTEM_PROMPT,
                prompt: `一句话创意：${text}`
            });
            const brief = fromModelJson(raw, { idea: text, title, video });
            log.info(`创意 Agent 使用文本模型完成：${brief.genre} / ${brief.title}`);
            return brief;
        } catch (error) {
            log.warn(`文本模型不可用，回退内置创意解析: ${error.message}`);
        }
    }
    const brief = offlineBrief({ idea: text, title, video });
    log.info(`创意 Agent 使用内置规则解析：${brief.genre} / ${brief.title} / 关键词 ${brief.keywords.join('、') || '无'}`);
    return brief;
}

module.exports = { buildBrief, offlineBrief, extractKeywords, inferGenre, toPromptText };
