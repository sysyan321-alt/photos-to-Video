'use strict';

const { createLogger } = require('../logger');
const { withBuiltins } = require('../domain/preset');

const log = createLogger('analytics');

/**
 * 数据闭环：把投放数据（播放/完播/点赞）回填到项目，
 * 再按「用了哪些提示词预设」聚合出效果排行，让新项目能推荐历史最优组合。
 *
 * 打分口径（透明可改）：score = 完播率 × 0.7 + 点赞率 × 0.3
 */
function scoreOf(metrics) {
    const completion = Number(metrics?.completion) || 0;
    const views = Number(metrics?.views) || 0;
    const likes = Number(metrics?.likes) || 0;
    const likeRate = views > 0 ? Math.min(1, likes / views) : 0;
    return Number((completion * 0.7 + likeRate * 0.3).toFixed(4));
}

function createAnalyticsService({ storage }) {
    function record(project, metrics) {
        project.metrics = {
            views: Number(metrics.views) || 0,
            completion: Number(metrics.completion) || 0,
            likes: Number(metrics.likes) || 0,
            note: metrics.note ? String(metrics.note).slice(0, 80) : '',
            score: scoreOf(metrics),
            updatedAt: new Date().toISOString()
        };
        storage.saveProject(project);
        log.info(`项目 ${project.id} 数据回填：完播 ${(project.metrics.completion * 100).toFixed(1)}%`);
        return project.metrics;
    }

    /** 项目用到的预设 id（项目级槽位 + 镜头级覆盖都算） */
    function presetsOf(project) {
        const ids = new Set();
        const assembly = (project.workflow?.nodes || []).find(node => node.id === 'prompt_assembly');
        const slots = assembly?.params?.slots || {};
        for (const value of Object.values(slots)) {
            if (Array.isArray(value)) value.forEach(id => ids.add(id));
        }
        for (const shot of project.shots || []) {
            (shot.preset_ids || []).forEach(id => ids.add(id));
        }
        return [...ids];
    }

    function presetRanking({ slot = 'style', minProjects = 1 } = {}) {
        const presets = withBuiltins(storage.loadPresets());
        const byId = new Map(presets.map(item => [item.id, item]));
        const buckets = new Map();

        for (const project of storage.listProjects()) {
            if (!project.metrics?.score) continue;
            for (const id of presetsOf(project)) {
                const preset = byId.get(id);
                if (!preset || (slot && preset.group !== slot)) continue;
                if (!buckets.has(id)) buckets.set(id, { id, name: preset.name, group: preset.group, scores: [], projects: [] });
                const bucket = buckets.get(id);
                bucket.scores.push(project.metrics.score);
                bucket.projects.push({ id: project.id, name: project.name, score: project.metrics.score });
            }
        }

        return [...buckets.values()]
            .filter(bucket => bucket.projects.length >= minProjects)
            .map(bucket => ({
                id: bucket.id,
                name: bucket.name,
                group: bucket.group,
                samples: bucket.scores.length,
                avgScore: Number((bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length).toFixed(4)),
                bestProject: bucket.projects.sort((a, b) => b.score - a.score)[0]
            }))
            .sort((a, b) => b.avgScore - a.avgScore);
    }

    return { record, scoreOf, presetsOf, presetRanking };
}

module.exports = { createAnalyticsService, scoreOf };
