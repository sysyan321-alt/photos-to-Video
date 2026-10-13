'use strict';

const { createLogger } = require('../logger');
const { toPromptText } = require('../domain/brief');

const log = createLogger('script-agent');

const EMOTIONS = ['紧绷', '克制', '错愕', '决绝', '不安'];

const BEAT_ROLES = [
    { role: 'hook', label: '开场钩子', fallback: '这一夜，他等的人终于出现了' },
    { role: 'setup', label: '交代处境', fallback: '可对方开口的第一句话，就让他愣在原地' },
    { role: 'conflict', label: '冲突升级', fallback: '“这件事，你别再管了。”' },
    { role: 'turn', label: '反转揭示', fallback: '他这才看清，那道疤和三年前一模一样' },
    { role: 'cliffhanger', label: '悬念收尾', fallback: '而他不知道，门外还站着第三个人' }
];

const NAME_POOL = [
    ['林深', '苏晚'],
    ['江砚', '温言'],
    ['陆时', '沈念'],
    ['顾北', '白鹿']
];

const SYSTEM_PROMPT = [
    '你是短片编剧，负责把用户的一句话创意改编成竖屏短片。',
    '要求：',
    '- 每集 15 秒左右，节奏极快',
    '- 第 1 个节拍必须是强钩子（前 3 秒抓住人）',
    '- 最后一个节拍必须留悬念或反转',
    '- 台词短、口语化、适合配音，单条不超过 22 个字',
    '- 只输出 JSON，不要任何解释',
    '',
    'JSON 结构：',
    '{',
    '  "title": "6 字以内标题",',
    '  "logline": "一句话剧情",',
    '  "genre": "题材",',
    '  "characters": [',
    '    {"id": "char_001", "name": "", "role": "", "appearance": "外貌和服装，具体到可以直接画图", "voice": {"tone": "", "speed": "", "style": ""}}',
    '  ],',
    '  "beats": [',
    '    {"index": 1, "role": "hook", "label": "开场钩子", "caption": "不超过22字的台词或字幕", "action": "画面里发生了什么", "emotion": "情绪"}',
    '  ]',
    '}'
].join('\n');

function hashString(text) {
    let hash = 2166136261;
    for (const char of String(text || '')) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function trimCaption(text, limit = 22) {
    const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
    if (chars.length <= limit) return chars.join('');
    return `${chars.slice(0, limit - 1).join('')}…`;
}

function splitBeats(idea, limit) {
    const sentences = String(idea || '')
        .split(/[。！？!?；;\n\r]+/)
        .map(text => text.trim())
        .filter(Boolean);
    const chunks = [];
    for (const sentence of sentences.length ? sentences : [String(idea || '').trim()]) {
        if (Array.from(sentence).length <= 26) {
            chunks.push(sentence);
            continue;
        }
        for (const piece of sentence.split(/[，,、]+/).map(text => text.trim()).filter(Boolean)) {
            chunks.push(piece);
        }
    }
    // 过短的分句（如「雨夜」）与相邻分句合并，避免出现没有信息量的镜头
    const merged = [];
    let index = 0;
    while (index < chunks.length) {
        let chunk = chunks[index];
        index += 1;
        while (Array.from(chunk).length < 6 && index < chunks.length) {
            chunk = `${chunk}，${chunks[index]}`;
            index += 1;
        }
        merged.push(chunk);
    }
    return merged.slice(0, limit);
}

function deriveTitle(idea) {
    // 离线兜底标题：优先用第一个自然分句，过长则截断（配置了文本模型时会用模型拟的标题）
    const firstClause = String(idea || '').split(/[，,。！？!?；;\s]+/).filter(Boolean)[0] || '';
    const chars = Array.from(firstClause);
    if (!chars.length) return '无声之夜';
    return chars.length <= 8 ? chars.join('') : chars.slice(0, 6).join('');
}

/** 离线编剧：把 Brief 里的创意原文切成节拍并套用短片节拍结构 */
function offlineScript({ brief, shotCount }) {
    const beats = splitBeats(brief.raw, shotCount);
    // 第一个节拍用创意 Agent 的钩子（前 3 秒留住人）；若钩子已经出现在后面的节拍里就不重复塞
    if (beats.length && brief.hook && brief.hook !== beats[0] && !beats.slice(1).includes(brief.hook)) {
        beats[0] = brief.hook;
    }
    const names = NAME_POOL[hashString(brief.raw || brief.title || 'comicdrama') % NAME_POOL.length];

    const characters = [
        {
            id: 'char_001',
            name: names[0],
            role: '主角',
            age: '20 出头',
            gender: '男',
            appearance: '黑色短发，眉眼锋利，左眉有一道浅疤，深灰风衣配黑色高领',
            outfit: '深灰风衣 + 黑色高领',
            voice: { tone: '低沉', speed: '中速', style: '克制' },
            reference_prompt: 'anime style young man, short black hair, sharp eyes, thin scar on left eyebrow, dark grey trench coat, plain background'
        },
        {
            id: 'char_002',
            name: names[1],
            role: '对手 / 搭档',
            age: '20 出头',
            gender: '女',
            appearance: '银白色长发低马尾，红色围巾，肤色偏冷，眼神疏离',
            outfit: '白衬衫 + 红色围巾',
            voice: { tone: '清冷', speed: '偏快', style: '冷静' },
            reference_prompt: 'anime style young woman, silver long hair in low ponytail, red scarf, pale skin, plain background'
        }
    ];

    const storyBeats = [];
    for (let index = 0; index < shotCount; index += 1) {
        const role = BEAT_ROLES[Math.min(index, BEAT_ROLES.length - 1)];
        const text = beats[index] || role.fallback;
        storyBeats.push({
            index: index + 1,
            role: role.role,
            label: role.label,
            caption: trimCaption(text),
            action: text,
            emotion: EMOTIONS[index % EMOTIONS.length]
        });
    }

    return {
        title: brief.title || deriveTitle(brief.raw),
        logline: trimCaption(brief.logline || brief.raw, 48),
        genre: brief.genre,
        tone: brief.tone,
        keywords: brief.keywords,
        characters,
        beats: storyBeats,
        source: 'offline'
    };
}

function normalizeScript(raw, { brief, shotCount }) {
    const fallback = offlineScript({ brief, shotCount });

    const characters = Array.isArray(raw?.characters) && raw.characters.length
        ? raw.characters.slice(0, 4).map((character, index) => ({
            id: character.id || `char_${String(index + 1).padStart(3, '0')}`,
            name: character.name || `角色${index + 1}`,
            role: character.role || '',
            age: character.age || '',
            gender: character.gender || '',
            appearance: character.appearance || '',
            outfit: character.outfit || '',
            voice: character.voice || { tone: '', speed: '', style: '' },
            reference_prompt: character.reference_prompt || character.appearance || ''
        }))
        : fallback.characters;

    const rawBeats = Array.isArray(raw?.beats) ? raw.beats : [];
    const storyBeats = [];
    for (let index = 0; index < shotCount; index += 1) {
        const role = BEAT_ROLES[Math.min(index, BEAT_ROLES.length - 1)];
        const beat = rawBeats[index] || {};
        const caption = beat.caption || beat.dialogue || beat.action || role.fallback;
        storyBeats.push({
            index: index + 1,
            role: beat.role || role.role,
            label: beat.label || role.label,
            caption: trimCaption(caption),
            action: beat.action || caption,
            emotion: beat.emotion || EMOTIONS[index % EMOTIONS.length]
        });
    }

    return {
        title: brief.title || raw?.title || fallback.title,
        logline: raw?.logline || fallback.logline,
        genre: raw?.genre || fallback.genre,
        tone: raw?.tone || brief.tone,
        keywords: brief.keywords,
        characters,
        beats: storyBeats,
        source: 'llm'
    };
}

async function buildScript({ brief, shotCount, llm }) {
    if (llm.enabled) {
        try {
            const raw = await llm.generateJson({
                system: SYSTEM_PROMPT,
                prompt: `${toPromptText(brief)}\n\n请生成 ${shotCount} 个节拍的竖屏短片剧本，总时长约 ${shotCount * 3} 秒。`
            });
            const script = normalizeScript(raw, { brief, shotCount });
            log.info('编剧 Agent 使用文本模型完成');
            return script;
        } catch (error) {
            log.warn(`文本模型不可用，回退内置编剧模板: ${error.message}`);
        }
    }
    log.info('编剧 Agent 使用内置离线模板');
    return offlineScript({ brief, shotCount });
}

module.exports = { buildScript, offlineScript, normalizeScript, splitBeats, trimCaption, hashString, EMOTIONS, SYSTEM_PROMPT };
