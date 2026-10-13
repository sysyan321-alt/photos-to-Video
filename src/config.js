'use strict';

/**
 * 配置优先级：环境变量 > env.yaml > 默认值。
 * env.yaml 支持两种写法：装了 js-yaml 用标准 YAML，否则退化为内置的扁平 key: value 解析。
 */

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(APP_ROOT, 'env.yaml');

function parseFlatYaml(raw) {
    const result = {};
    for (const line of String(raw).split(/\r?\n/)) {
        const text = line.trim();
        if (!text || text.startsWith('#') || text.startsWith('-')) continue;
        const index = text.indexOf(':');
        if (index <= 0) continue;
        const key = text.slice(0, index).trim();
        let value = text.slice(index + 1).trim();
        if (value.length >= 2) {
            const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
            if (quoted) value = value.slice(1, -1);
        }
        if (value === '') continue;
        result[key] = value;
    }
    return result;
}

function readEnvFile(filePath = ENV_FILE) {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return {};
        const raw = fs.readFileSync(filePath, 'utf8');
        try {
            const yaml = require('js-yaml');
            const parsed = yaml.load(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (error) {
            // 未安装 js-yaml：走内置解析器
        }
        return parseFlatYaml(raw);
    } catch (error) {
        return {};
    }
}

function createConfig() {
    const file = readEnvFile();

    const read = (yamlKey, envKey, fallback = '') => {
        const envValue = process.env[envKey];
        if (typeof envValue === 'string' && envValue.trim() !== '') return envValue.trim();
        const fileValue = file[yamlKey];
        if (fileValue !== undefined && fileValue !== null && String(fileValue).trim() !== '') {
            return String(fileValue).trim();
        }
        return fallback;
    };

    const toInt = (value, fallback) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const toNumber = (value, fallback) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const outputRoot = read('Comic-Output-Root', 'COMIC_OUTPUT_ROOT',
        fs.existsSync('/data') ? '/data/growalbum' : path.join(APP_ROOT, 'data'));

    const video = {
        width: toInt(read('Comic-Video-Width', 'COMIC_VIDEO_WIDTH', '1080'), 1080),
        height: toInt(read('Comic-Video-Height', 'COMIC_VIDEO_HEIGHT', '1920'), 1920),
        fps: toInt(read('Comic-Video-FPS', 'COMIC_VIDEO_FPS', '25'), 25),
        shotSeconds: toNumber(read('Comic-Shot-Seconds', 'COMIC_SHOT_SECONDS', '3'), 3),
        shots: toInt(read('Comic-Shot-Count', 'COMIC_SHOT_COUNT', '5'), 5)
    };
    video.totalSeconds = Number((video.shotSeconds * video.shots).toFixed(3));

    const geminiKey = read('Gemini-API-KEY', 'GEMINI_API_KEY', '');
    const geminiBaseUrl = read('Gemini-BASE-URL', 'GEMINI_BASE_URL', '').replace(/\/+$/, '');
    const geminiImageModel = read('Gemini-MODEL', 'GEMINI_IMAGE_MODEL', '');
    const geminiTextModel = read('Gemini-Text-MODEL', 'GEMINI_TEXT_MODEL', 'gemini-2.5-flash');

    const ttsKey = read('TTS-API-KEY', 'TTS_API_KEY', '');
    const ttsPromptAudioUrl = read('TTS-Prompt-Audio-URL', 'TTS_PROMPT_AUDIO_URL', '');
    const ttsPromptText = read('TTS-Prompt-Text', 'TTS_PROMPT_TEXT', '');

    // 配音 provider：IndexTTS（第三方）或百炼 Qwen3-TTS
    const ttsCandidates = {
        indextts: {
            provider: 'indextts',
            endpoint: read('TTS-Endpoint', 'TTS_ENDPOINT', 'https://ai.gitee.com/v1/audio/speech'),
            apiKey: ttsKey,
            model: read('TTS-Model', 'TTS_MODEL', 'IndexTTS-2'),
            promptAudioUrl: ttsPromptAudioUrl,
            promptText: ttsPromptText,
            enabled: Boolean(ttsKey && ttsPromptAudioUrl && ttsPromptText)
        },
        aliyun: {
            provider: 'aliyun',
            baseUrl: read('Provider-aliyun-BASE-URL', 'DASHSCOPE_BASE_URL', 'https://maas.qianwenaiapi.com').replace(/\/+$/, ''),
            apiKey: read('Provider-aliyun-API-KEY', 'DASHSCOPE_API_KEY', ''),
            model: read('Provider-aliyun-TTS-MODEL', 'DASHSCOPE_TTS_MODEL', 'qwen3-tts-flash'),
            voice: read('Provider-aliyun-TTS-VOICE', 'DASHSCOPE_TTS_VOICE', 'Cherry'),
            enabled: Boolean(
                read('Provider-aliyun-BASE-URL', 'DASHSCOPE_BASE_URL', 'https://maas.qianwenaiapi.com')
                && read('Provider-aliyun-API-KEY', 'DASHSCOPE_API_KEY', '')
            )
        }
    };
    const ttsKeyName = read('Provider-TTS', 'COMIC_PROVIDER_TTS', 'indextts');
    const tts = ttsCandidates[ttsKeyName] || ttsCandidates.indextts;

    // 图生视频：可灵（Kling，JWT/Key 两种鉴权）与阿里云百炼（DashScope，第三方视频模型）
    const aliyunApiKey = read('Provider-aliyun-API-KEY', 'DASHSCOPE_API_KEY', '');
    const aliyunBaseUrl = read('Provider-aliyun-BASE-URL', 'DASHSCOPE_BASE_URL', 'https://maas.qianwenaiapi.com').replace(/\/+$/, '');

    const i2vCandidates = {
        kling: {
            provider: 'kling',
            baseUrl: read('Provider-kling-BASE-URL', 'KLING_BASE_URL', 'https://api-beijing.klingai.com').replace(/\/+$/, ''),
            apiKey: read('Provider-kling-API-KEY', 'KLING_API_KEY', ''),
            accessKey: read('Provider-kling-ACCESS-KEY', 'KLING_ACCESS_KEY', ''),
            secretKey: read('Provider-kling-SECRET-KEY', 'KLING_SECRET_KEY', ''),
            model: read('Provider-kling-MODEL', 'KLING_MODEL', 'kling-v1-6'),
            mode: read('Provider-kling-MODE', 'KLING_MODE', 'std')
        },
        aliyun: {
            provider: 'aliyun',
            baseUrl: aliyunBaseUrl,
            apiKey: aliyunApiKey,
            model: read('Provider-aliyun-MODEL', 'DASHSCOPE_MODEL', ''),
            size: read('Provider-aliyun-SIZE', 'DASHSCOPE_SIZE', '720*1280'),
            resolution: read('Provider-aliyun-RESOLUTION', 'DASHSCOPE_RESOLUTION', '720P'),
            mode: read('Provider-aliyun-MODE', 'DASHSCOPE_MODE', 'std')
        }
    };
    const i2vKey = read('Provider-I2V', 'COMIC_PROVIDER_I2V', 'kling');
    const i2v = i2vCandidates[i2vKey] || i2vCandidates.kling;

    // 图像模型：Gemini/NanoBanana 或百炼 Qwen-Image
    const imageCandidates = {
        gemini: {
            provider: 'gemini',
            baseUrl: geminiBaseUrl,
            apiKey: geminiKey,
            model: geminiImageModel,
            aspectRatio: '9:16'
        },
        aliyun: {
            provider: 'aliyun',
            baseUrl: aliyunBaseUrl,
            apiKey: aliyunApiKey,
            model: read('Provider-aliyun-IMAGE-MODEL', 'DASHSCOPE_IMAGE_MODEL', 'qwen-image-3.0'),
            size: read('Provider-aliyun-IMAGE-SIZE', 'DASHSCOPE_IMAGE_SIZE', '720*1280'),
            aspectRatio: '9:16'
        }
    };
    const imageKey = read('Provider-Image', 'COMIC_PROVIDER_IMAGE', 'gemini');
    const image = imageCandidates[imageKey] || imageCandidates.gemini;

    // provider 选择：换厂只改这里（或环境变量 COMIC_PROVIDER_LLM 等）
    const providers = {
        llm: read('Provider-LLM', 'COMIC_PROVIDER_LLM', 'gemini'),
        image: read('Provider-Image', 'COMIC_PROVIDER_IMAGE', 'gemini'),
        i2v: read('Provider-I2V', 'COMIC_PROVIDER_I2V', 'kling'),
        tts: read('Provider-TTS', 'COMIC_PROVIDER_TTS', 'indextts')
    };

    const workflow = {
        defaultTemplate: read('Comic-Workflow-Template', 'COMIC_WORKFLOW_TEMPLATE', 'vertical-15s')
    };

    return {
        appRoot: APP_ROOT,
        envFile: ENV_FILE,
        port: toInt(read('Comic-Port', 'PORT', '8787'), 8787),
        outputRoot,
        video,
        providers,
        workflow,
        i2v: {
            ...i2v,
            maxSeconds: toInt(read('Provider-I2V-MAX-SECONDS', 'COMIC_I2V_MAX_SECONDS', '5'), 5),
            pollIntervalMs: toInt(read('Provider-I2V-POLL-MS', 'COMIC_I2V_POLL_MS', '5000'), 5000),
            timeoutMs: toInt(read('Provider-I2V-TIMEOUT-MS', 'COMIC_I2V_TIMEOUT_MS', '900000'), 900000),
            enabled: Boolean(i2v.baseUrl && (i2v.apiKey || (i2v.accessKey && i2v.secretKey)))
        },
        models: {
            llm: {
                baseUrl: geminiBaseUrl,
                apiKey: geminiKey,
                model: geminiTextModel,
                enabled: Boolean(geminiBaseUrl && geminiKey)
            },
            image: {
                baseUrl: image.baseUrl,
                apiKey: image.apiKey,
                model: image.model,
                size: image.size,
                aspectRatio: image.aspectRatio,
                // 关键帧必须按竖屏出图，因此要求显式配置图像模型
                enabled: Boolean(image.baseUrl && image.apiKey && image.model)
            },
            tts: {
                ...tts
            }
        }
    };
}

function describeConfig(config) {
    const { llm, image, tts } = config.models;
    const enabledCount = [llm, image, tts].filter(model => model.enabled).length;
    return {
        outputRoot: config.outputRoot,
        video: config.video,
        mode: enabledCount === 0 ? 'offline' : enabledCount === 3 ? 'full-model' : 'hybrid',
        models: {
            llm: { enabled: llm.enabled, model: llm.model },
            image: { enabled: image.enabled, model: image.model || null },
            tts: { enabled: tts.enabled, model: tts.model }
        }
    };
}

module.exports = { APP_ROOT, ENV_FILE, createConfig, describeConfig, readEnvFile, parseFlatYaml };
