'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const log = createLogger('vision');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * 视觉理解服务（百炼 Qwen-VL）。
 * 用途：风格反推 —— 从你自己的图里提炼可复用的画风描述，直接变成提示词库预设。
 * 单次成本约 0.001 元，比本地跑 CLIP 之类的方案省事得多。
 */
function createVisionService({ baseUrl, apiKey, model = 'qwen3-vl-plus' }) {
    const enabled = Boolean(baseUrl && apiKey);

    async function ask({ imagePath, prompt, images, timeoutMs = 120000 }) {
        if (!enabled) throw new Error('视觉模型未配置');
        let content;
        if (Array.isArray(images) && images.length) {
            // 调用方直接组装 content（多图比对场景，例如一致性打分）
            content = images;
        } else {
            if (!imagePath || !fs.existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`);
            const mime = MIME[path.extname(imagePath).toLowerCase()] || 'image/png';
            const dataUri = `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
            content = [{ image: dataUri }, { text: prompt }];
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    input: { messages: [{ role: 'user', content }] }
                }),
                signal: controller.signal
            });
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (error) {
                throw new Error(`返回不是 JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || text.slice(0, 200)}`);
            // 注意：不要叫 content —— 与上面的入参 content 同处一个块作用域，会踩 TDZ
            const answerParts = data?.output?.choices?.[0]?.message?.content || [];
            const answer = answerParts.map(item => item.text || '').join('').trim();
            if (!answer) throw new Error(`模型没有返回文本: ${JSON.stringify(data).slice(0, 200)}`);
            return answer;
        } finally {
            clearTimeout(timer);
        }
    }

    /** 风格反推：输出一段可直接当 style 预设用的中文描述 */
    async function describeStyle(imagePath) {
        const answer = await ask({
            imagePath,
            prompt: '用 30 字以内描述这张图的画风、光线与构图，只输出描述本身，不要任何前后缀。'
        });
        log.info(`风格反推结果: ${answer}`);
        return answer.replace(/[。.]$/, '');
    }

    /**
     * 智能选图：给单张图打分（0-10），用于挑钩子镜头 / 封面。
     * 要求严格 JSON；解析失败按 0 分处理，不影响整体流程。
     */
    async function scoreImage({ imagePath, purpose = '竖屏短剧的钩子镜头' }) {
        const answer = await ask({
            imagePath,
            prompt: `这张图适合作${purpose}吗？从构图、主体清晰度、情绪张力三方面打分。只输出 JSON：{"score": 0 到 10, "reason": "20字以内"}`
        });
        try {
            const cleaned = answer.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            const parsed = JSON.parse(cleaned.slice(start, end + 1));
            return { score: Number(parsed.score) || 0, reason: String(parsed.reason || '').slice(0, 40) };
        } catch (error) {
            log.warn(`打分结果解析失败: ${answer.slice(0, 80)}`);
            return { score: 0, reason: answer.slice(0, 40) };
        }
    }

    /**
     * 一致性打分：把镜头画面与角色参考图比对，找出"跑样"的镜头。
     * 这是短片最致命的失败模式，靠人眼逐帧看很累，交给视觉模型一次比对即可。
     */
    async function compareImages({ imagePath, referencePath, purpose = '角色是否同一个人' }) {
        if (!fs.existsSync(referencePath)) throw new Error(`参考图不存在: ${referencePath}`);
        const toUri = file => {
            const mime = MIME[path.extname(file).toLowerCase()] || 'image/png';
            return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
        };
        const answer = await ask({
            imagePath,
            prompt: '__TWO_IMAGES__',
            images: [
                { image: toUri(imagePath) },
                { image: toUri(referencePath) },
                { text: `第一张是镜头画面，第二张是角色参考图。判断${purpose}，重点看发型发色、五官、服装。只输出 JSON：{"score": 0 到 10, "diff": "20字以内差异描述"}` }
            ]
        });
        try {
            const cleaned = answer.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
            return { score: Number(parsed.score) || 0, diff: String(parsed.diff || '').slice(0, 40) };
        } catch (error) {
            log.warn(`一致性结果解析失败: ${answer.slice(0, 80)}`);
            return { score: 0, diff: answer.slice(0, 40) };
        }
    }

    /**
     * 相册 → 故事：给一组图，让模型写一部竖屏短片的梗概与分镜节拍。
     * 这是"图片驱动创意"的入口：你上传的素材决定故事，而不是先有文字再配图。
     */
    async function writeStoryFromImages({ imagePaths, shots = 5 }) {
        const images = imagePaths.slice(0, 6).map(file => {
            const mime = MIME[path.extname(file).toLowerCase()] || 'image/png';
            return { image: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
        });
        const answer = await ask({
            imagePath: imagePaths[0],
            images: [...images, {
                text: `以上是我手上的素材。请据此写一部竖屏短剧，输出 JSON：{"title":"6字以内","logline":"一句话剧情","beats":[{"caption":"不超过22字的台词或字幕","action":"画面里发生了什么"}]}，beats 恰好 ${shots} 条，节奏要快、结尾留悬念。只输出 JSON。`
            }],
            timeoutMs: 180000
        });
        const cleaned = answer.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
        return {
            title: String(parsed.title || '相册短剧').slice(0, 12),
            logline: String(parsed.logline || '').slice(0, 60),
            beats: (parsed.beats || []).slice(0, shots).map((beat, index) => ({
                index: index + 1,
                caption: String(beat.caption || '').slice(0, 22),
                action: String(beat.action || '')
            }))
        };
    }

    /**
     * 审核：一次调用同时判「合规风险」和「图文一致性」。
     * 输入关键帧 + 对应字幕；输出风险等级、问题清单、修改建议。
     */
    async function auditProject({ imagePaths, captions = [] }) {
        const images = imagePaths.slice(0, 3).map(file => {
            const mime = MIME[path.extname(file).toLowerCase()] || 'image/png';
            return { image: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
        });
        const captionText = captions
            .map((item, index) => `${index + 1}. ${item.shot_id || ''} 字幕：${item.caption || '（无）'}`)
            .join('\n');
        const answer = await ask({
            imagePath: imagePaths[0],
            images: [...images, {
                text: `上面是该短片的关键帧画面，下面是各镜头字幕：\n${captionText}\n\n请做两件事：\n1) 内容安全审核（政治敏感、暴力血腥、色情、违法、未成年人不当内容、侵权风险）\n2) 检查字幕与画面是否对得上（是否文不对图）\n只输出 JSON：{"risk":"low|medium|high","issues":["具体问题"],"suggestions":["可执行建议"]}`
            }],
            timeoutMs: 180000
        });
        const cleaned = answer.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
        return {
            risk: ['low', 'medium', 'high'].includes(parsed.risk) ? parsed.risk : 'medium',
            issues: (parsed.issues || []).slice(0, 8).map(item => String(item).slice(0, 120)),
            suggestions: (parsed.suggestions || []).slice(0, 8).map(item => String(item).slice(0, 120))
        };
    }

    return { enabled, model, ask, describeStyle, scoreImage, compareImages, writeStoryFromImages, auditProject };
}

module.exports = { createVisionService };
