'use strict';

const crypto = require('crypto');
const { createLogger } = require('../logger');
const workflow = require('../workflow');
const { runPreproduction } = require('../agents/producer');

const log = createLogger('batch');

/**
 * 批量生产：一次投多条创意 → 逐条立项 → 串行渲染。
 * 串行是刻意的：避免并发限流，也让预算护栏（pricing）能逐条生效、超支即停。
 */
function createBatchService({ config, providers, storage, jobs }) {
    const batchesFile = require('path').join(storage.root, 'batches', 'index.json');
    // 启动时恢复历史批次，避免重启即失忆
    const batches = new Map((storage.readJson(batchesFile, []) || []).map(item => [item.id, item]));

    function persist() {
        try {
            storage.writeJson(batchesFile, [...batches.values()].slice(-50));
        } catch (error) {
            log.warn(`批次落盘失败: ${error.message}`);
        }
    }

    async function renderItem(batch, item) {
        item.status = 'rendering';
        const project = storage.getProject(item.projectId);
        if (!project) {
            item.status = 'failed';
            item.error = '项目不存在';
            return;
        }
        const template = workflow.getTemplate(project.workflow?.templateId || config.workflow.defaultTemplate);
        const steps = workflow.stepsForStage(workflow.resolveNodes(template, project.workflow?.overrides || {}), 'render');
        const job = jobs.createJob('render', project.id, steps);
        try {
            await workflow.runStage({ project, template, stage: 'render', config, providers, storage, job, jobs });
            project.status = project.outputs?.video ? 'completed' : 'storyboard_ready';
            storage.saveProject(project);
            jobs.setStatus(job, 'succeeded');
            item.status = project.outputs?.video ? 'completed' : 'partial';
            item.video = project.outputs?.video || null;
        } catch (error) {
            jobs.setStatus(job, 'failed');
            item.status = 'failed';
            item.error = error.message;
            log.warn(`批次 ${batch.id} 中「${item.name || item.idea}」失败: ${error.message}`);
        }
        item.spendYuan = Number(project.spend?.yuan) || 0;
    }

    async function start({ ideas, templateId }) {
        const batch = {
            id: `bat_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
            createdAt: new Date().toISOString(),
            templateId: templateId || config.workflow.defaultTemplate,
            status: 'preparing',
            spendYuan: 0,
            items: []
        };
        batches.set(batch.id, batch);
        persist();

        for (const idea of ideas) {
            try {
                const project = await runPreproduction({
                    idea,
                    templateId: batch.templateId,
                    config,
                    providers,
                    storage
                });
                batch.items.push({ idea, projectId: project.id, name: project.name, status: 'queued', spendYuan: 0 });
            } catch (error) {
                batch.items.push({ idea, status: 'failed', error: error.message, spendYuan: 0 });
            }
        }
        log.info(`批次 ${batch.id} 立项完成：${batch.items.length} 条`);
        persist();

        // 串行渲染（后台跑，接口立即返回批次号）
        (async () => {
            batch.status = 'rendering';
            for (const item of batch.items) {
                if (item.status === 'failed') continue;
                await renderItem(batch, item);
                batch.spendYuan = Number(batch.items.reduce((sum, one) => sum + (one.spendYuan || 0), 0).toFixed(4));
            }
            batch.status = 'done';
            batch.finishedAt = new Date().toISOString();
            persist();
            const ok = batch.items.filter(item => item.status === 'completed').length;
            log.info(`批次 ${batch.id} 完成：成功 ${ok}/${batch.items.length}，累计 ${batch.spendYuan} 元`);
        })();

        return batch;
    }

    /**
     * 断点续跑：启动时把没跑完的批次重新入队。
     * 已成片/已失败的条目直接跳过 —— 配合素材缓存，续跑不会重复花钱。
     */
    function resumePending() {
        const pending = [...batches.values()].filter(item => ['preparing', 'rendering'].includes(item.status));
        for (const batch of pending) {
            const queue = batch.items.filter(item => item.projectId && !['completed', 'failed'].includes(item.status));
            if (!queue.length) {
                batch.status = 'done';
                batch.finishedAt = batch.finishedAt || new Date().toISOString();
                persist();
                continue;
            }
            log.info(`续跑批次 ${batch.id}：剩余 ${queue.length} 条`);
            batch.status = 'rendering';
            persist();
            for (const item of queue) item.status = 'queued';
            setImmediate(async () => {
                for (const item of queue) {
                    await renderItem(batch, item);
                    batch.spendYuan = Number(batch.items.reduce((sum, one) => sum + (one.spendYuan || 0), 0).toFixed(4));
                    persist();
                }
                batch.status = 'done';
                batch.finishedAt = new Date().toISOString();
                persist();
                log.info(`批次 ${batch.id} 续跑完成，累计 ${batch.spendYuan} 元`);
            });
        }
    }

    // 启动后延迟一拍执行，避免与 http 服务启动抢资源
    setTimeout(resumePending, 1500);

    return {
        start,
        get: id => batches.get(id) || null,
        list: () => [...batches.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        resumePending
    };
}

module.exports = { createBatchService };
