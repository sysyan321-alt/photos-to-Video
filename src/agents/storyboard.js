'use strict';

const { createLogger } = require('../logger');

const log = createLogger('storyboard-agent');

// 竖屏短片的镜头节奏：特写钩子 -> 环境 -> 对峙 -> 反转 -> 留白
const SHOT_PLAN = [
    { shot_size: '特写', camera: '缓慢推近', visual: '主角面部特写占满画面，眼神收紧，背景压暗，侧逆光勾出轮廓', sfx: '心跳声' },
    { shot_size: '中景', camera: '横向平移', visual: '环境中景交代场景，主角位于画面下三分之一，前景有遮挡物制造纵深', sfx: '环境底噪' },
    { shot_size: '近景', camera: '手持轻晃', visual: '双人过肩近景，对角线构图对峙，背景速度线增强压迫感', sfx: '布料摩擦' },
    { shot_size: '全景', camera: '缓慢拉远', visual: '低角度全景，主体被逆光勾勒出剪影，地面反光拉长影子', sfx: '低频轰响' },
    { shot_size: '远景', camera: '轻微上摇', visual: '主体背对镜头走向远处光源，画面大量留白，字幕压底', sfx: '风声渐强' }
];

const SYSTEM_PROMPT = [
    '你是短片分镜师，把剧本拆成竖屏短片分镜。只输出 JSON，不要解释。',
    '每个镜头 2-5 秒，画面描述必须包含景别、运镜、角色动作、表情、光线。',
    'JSON 结构：',
    '{"shots":[{"shot_id":"ep1_s01","duration":3,"shot_size":"近景","camera":"缓慢推近","visual_desc":"","characters":["char_001"],"dialogue":"","sfx":"","bgm":"","motion":""}]}'
].join('\n');

function offlineShots({ script, video }) {
    const shots = [];
    for (let index = 0; index < script.beats.length; index += 1) {
        const beat = script.beats[index];
        const plan = SHOT_PLAN[Math.min(index, SHOT_PLAN.length - 1)];
        shots.push({
            shot_id: `ep1_s${String(index + 1).padStart(2, '0')}`,
            episode: 1,
            scene: index + 1,
            duration: video.shotSeconds,
            shot_size: plan.shot_size,
            camera: plan.camera,
            visual_desc: `${plan.visual}；动作：${beat.action}`,
            characters: (script.characters || []).map(character => character.id).slice(0, 2),
            dialogue: beat.caption,
            caption: beat.caption,
            narration: beat.label,
            sfx: plan.sfx,
            bgm: '轻悬疑铺底',
            motion: '轻动态（推拉摇移 + 轻微表情）',
            // 图生视频专用：只讲"动什么、怎么动"，不掺静态美术词
            motion_prompt: `${beat.action}；镜头${plan.camera}`,
            emotion: beat.emotion
        });
    }
    return shots;
}

function normalizeShots(raw, { script, video }) {
    const fallback = offlineShots({ script, video });
    const rawShots = Array.isArray(raw?.shots) ? raw.shots : [];
    if (!rawShots.length) return fallback;

    const shots = [];
    for (let index = 0; index < script.beats.length; index += 1) {
        const fallbackShot = fallback[index];
        const shot = rawShots[index] || {};
        shots.push({
            ...fallbackShot,
            duration: Number(shot.duration) > 0 ? Number(shot.duration) : fallbackShot.duration,
            shot_size: shot.shot_size || fallbackShot.shot_size,
            camera: shot.camera || fallbackShot.camera,
            visual_desc: shot.visual_desc || fallbackShot.visual_desc,
            characters: Array.isArray(shot.characters) && shot.characters.length ? shot.characters : fallbackShot.characters,
            dialogue: shot.dialogue || fallbackShot.dialogue,
            caption: shot.dialogue || fallbackShot.caption,
            sfx: shot.sfx || fallbackShot.sfx,
            bgm: shot.bgm || fallbackShot.bgm,
            motion: shot.motion || fallbackShot.motion
            ,motion_prompt: shot.motion_prompt || shot.motion || fallbackShot.motion_prompt
        });
    }
    return shots;
}

async function buildStoryboard({ script, video, llm }) {
    if (llm.enabled) {
        try {
            const raw = await llm.generateJson({
                system: SYSTEM_PROMPT,
                prompt: `剧本：${JSON.stringify(script)}\n\n请拆出 ${script.beats.length} 个镜头，每个镜头 ${video.shotSeconds} 秒，竖屏 9:16。`
            });
            const shots = normalizeShots(raw, { script, video });
            log.info(`分镜 Agent 使用文本模型完成，共 ${shots.length} 个镜头`);
            return { episode: 1, total_duration: video.totalSeconds, source: 'llm', shots };
        } catch (error) {
            log.warn(`文本模型不可用，回退内置分镜模板: ${error.message}`);
        }
    }
    const shots = offlineShots({ script, video });
    log.info(`分镜 Agent 使用内置模板，共 ${shots.length} 个镜头`);
    return { episode: 1, total_duration: video.totalSeconds, source: 'offline', shots };
}

module.exports = { buildStoryboard, offlineShots, SHOT_PLAN, SYSTEM_PROMPT };
