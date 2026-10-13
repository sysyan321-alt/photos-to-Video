'use strict';

/**
 * 数据模型对齐 ComicDrama.md 第 5.5 节：
 * Project / Episode / Character / Shot / Asset / Job
 */

function createProject({ id, idea, title, video, style }) {
    return {
        id,
        name: title || '',
        initialIdea: idea || '',
        createdAt: new Date().toISOString(),
        status: 'draft',
        brief: null,
        briefId: null,
        style: style || null,
        ratio: '9:16',
        targetDuration: video.totalSeconds,
        video,
        episode: {
            id: 'ep1',
            episode_no: 1,
            title: title || '',
            duration: video.totalSeconds
        },
        characters: [],
        shots: [],
        // 工作流：模板 id + 节点启停/参数覆盖 + 执行记录
        workflow: null,
        nodeRuns: [],
        assets: {
            keyframes: [],
            clips: [],
            shotVideos: {},
            audio: null
        },
        outputs: {},
        publishPack: null,
        script: null
    };
}

module.exports = { createProject };
