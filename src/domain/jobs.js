'use strict';

const crypto = require('crypto');
const { createLogger } = require('../logger');

const log = createLogger('jobs');
const jobs = new Map();

// 由 index.js 注入持久化钩子（写 project 目录下的 job.json），避免与 storage 循环依赖
let persist = () => {};

function setPersistence(fn) {
    persist = typeof fn === 'function' ? fn : () => {};
}

function touch(job) {
    job.updatedAt = new Date().toISOString();
    try {
        persist(job);
    } catch (error) {
        log.warn('任务快照写入失败', { message: error.message });
    }
}

function createJob(kind, projectId, stepNames = []) {
    const job = {
        id: `job_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
        kind,
        projectId,
        status: 'queued',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        steps: stepNames.map(name => ({ name, status: 'pending', detail: null })),
        logs: [],
        result: null,
        error: null
    };
    jobs.set(job.id, job);
    touch(job);
    return job;
}

function getJob(id) {
    return jobs.get(id) || null;
}

function listJobs(projectId) {
    return [...jobs.values()]
        .filter(job => !projectId || job.projectId === projectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function setStatus(job, status) {
    job.status = status;
    touch(job);
}

function appendLog(job, message) {
    job.logs.push({ at: new Date().toISOString(), message });
    if (job.logs.length > 300) job.logs.shift();
    log.info(`[${job.id}] ${message}`);
    touch(job);
}

function findStep(job, name) {
    return job.steps.find(step => step.name === name) || null;
}

function startStep(job, name) {
    // 第一个步骤开始跑就说明任务真的在跑了，否则整个渲染过程 UI 都停在「排队中」
    if (job.status === 'queued') job.status = 'running';
    const step = findStep(job, name);
    if (step) {
        step.status = 'running';
        step.startedAt = new Date().toISOString();
    }
    recomputeProgress(job);
    touch(job);
}

function finishStep(job, name, detail = null) {
    const step = findStep(job, name);
    if (step) {
        step.status = 'succeeded';
        step.finishedAt = new Date().toISOString();
        step.detail = detail;
    }
    recomputeProgress(job);
    touch(job);
}

function failStep(job, name, message) {
    const step = findStep(job, name);
    if (step) {
        step.status = 'failed';
        step.finishedAt = new Date().toISOString();
        step.detail = message;
    }
    recomputeProgress(job);
    touch(job);
}

function recomputeProgress(job) {
    if (!job.steps.length) {
        job.progress = job.status === 'succeeded' ? 100 : 0;
        return;
    }
    const weights = job.steps.map(step => {
        if (step.status === 'succeeded') return 1;
        if (step.status === 'running') return 0.5;
        return 0;
    });
    job.progress = Math.round((weights.reduce((sum, value) => sum + value, 0) / job.steps.length) * 100);
}

module.exports = {
    createJob,
    getJob,
    listJobs,
    setStatus,
    appendLog,
    startStep,
    finishStep,
    failStep,
    setPersistence
};
