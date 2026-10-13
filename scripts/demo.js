'use strict';

/**
 * 容器内端到端自检：走真实 HTTP 接口，创建项目 -> 渲染 -> 轮询 -> 打印成片信息。
 * 用法：docker compose exec growalbum node scripts/demo.js "一句话创意"
 */

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8787';
const idea = process.argv.slice(2).join(' ').trim()
    || '雨夜，他回到三年前出事的旧楼，电梯里却站着本该已经死去的她。';

async function getJson(path, options) {
    const response = await fetch(`${BASE}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
}

async function main() {
    const health = await getJson('/api/health');
    console.log(`ffmpeg: ${health.ffmpeg}`);
    console.log(`字幕字体: ${health.subtitleFont || '未找到'}`);
    console.log(`模型: LLM=${health.models.llm.enabled} 图像=${health.models.image.enabled} TTS=${health.models.tts.enabled}\n`);

    // 创意模块可以独立于项目调用
    const { brief } = await getJson('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea })
    });
    console.log(`① 创意 Brief ${brief.id} 「${brief.title}」`);
    console.log(`   题材 ${brief.genre} · 基调 ${brief.tone} · 关键词 ${brief.keywords.join('、') || '无'}`);
    console.log(`   钩子 ${brief.hook}\n`);

    const created = await getJson('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief })
    });
    console.log(`② 项目 ${created.project.id} 「${created.project.name}」 ${created.project.shotCount} 个镜头`);

    const started = await getJson(`/api/projects/${created.project.id}/render`, { method: 'POST' });
    console.log(`③ 渲染任务 ${started.jobId} 已提交\n`);

    let job = null;
    for (let attempt = 0; attempt < 300; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        job = (await getJson(`/api/jobs/${started.jobId}`)).job;
        const steps = job.steps.map(step => `${step.name}:${step.status}`).join(' ');
        process.stdout.write(`\r   进度 ${String(job.progress).padStart(3)}% [${job.status}] ${steps}      `);
        if (job.status === 'succeeded' || job.status === 'failed') break;
    }
    process.stdout.write('\n\n');

    for (const entry of (job.logs || []).slice(-12)) console.log(`   · ${entry.message}`);

    if (job.status !== 'succeeded') throw new Error(job.error || '渲染失败');

    console.log('\n④ 成片:');
    console.log(JSON.stringify(job.result, null, 2));
}

main().catch(error => {
    console.error(`\n自检失败: ${error.message}`);
    process.exit(1);
});
