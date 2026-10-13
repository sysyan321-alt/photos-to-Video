'use strict';

/**
 * 冒烟测试：不启动 HTTP 服务，直接跑工作流的「前期」阶段
 * （创意 → 剧本 → 角色卡 → 分镜 → 提示词组装 → 图片来源）。
 * 用法：node scripts/smoke.js "你的创意"
 * 需要出片时改用：docker compose up -d --build
 */

const { createConfig, describeConfig } = require('../src/config');
const { createStorage } = require('../src/services/storage');
const { createRegistry } = require('../src/providers/registry');
const { buildBrief } = require('../src/agents/idea');
const { runPreproduction } = require('../src/agents/producer');
const workflow = require('../src/workflow');

async function main() {
    const idea = process.argv.slice(2).join(' ').trim()
        || '雨夜，他回到三年前出事的旧楼，电梯里却站着本该已经死去的她。';

    const config = createConfig();
    const storage = createStorage(config);
    const providers = createRegistry(config);
    const summary = describeConfig(config);

    console.log(`运行模式: ${summary.mode}`);
    console.log(`成片规格: ${config.video.width}x${config.video.height} / ${config.video.totalSeconds}s / ${config.video.shots} 镜头`);
    console.log(`产物目录: ${config.outputRoot}`);
    console.log(`provider: llm=${providers.get('llm').id}  image=${providers.get('image').id}  tts=${providers.get('tts').id}`);
    console.log(`模板: ${workflow.listTemplates().map(item => `${item.id}(${item.nodeCount} 节点)`).join(', ')}\n`);

    // 创意模块可以独立使用：一句话创意 → Brief
    const brief = await buildBrief({ idea, title: '', video: config.video, llm: providers.get('llm') });
    storage.saveBrief(brief);
    console.log('创意简报:');
    console.log(`  标题     : ${brief.title}（${brief.source}）`);
    console.log(`  题材/基调: ${brief.genre} / ${brief.tone}`);
    console.log(`  钩子     : ${brief.hook}`);
    console.log(`  关键词   : ${brief.keywords.join(' · ') || '无'}\n`);

    const project = await runPreproduction({ idea, brief, config, providers, storage });

    console.log(`项目: ${project.id} 「${project.name}」 模板: ${project.workflow.templateName}\n`);
    console.log('节点执行记录:');
    for (const run of project.nodeRuns) {
        const mark = run.status === 'succeeded' ? '✔' : run.status === 'degraded' ? '▲' : run.status === 'skipped' ? '·' : '✘';
        console.log(`  ${mark} ${run.nodeId.padEnd(16)} ${run.status.padEnd(10)} ${run.detail || ''}`);
    }

    console.log('\n角色卡:');
    for (const character of project.characters) {
        console.log(`  - ${character.id} ${character.name} / ${character.role}：${character.appearance}`);
    }

    console.log('\n分镜表:');
    for (const shot of project.shots) {
        console.log(`  ${shot.shot_id} ${shot.shot_size}/${shot.camera} ${shot.duration}s 来源=${shot.image_source} [${shot.emotion}] ${shot.caption}`);
    }

    console.log('\n首个镜头的最终提示词:');
    console.log(project.shots[0].keyframe_prompt.split('\n').map(line => `  ${line}`).join('\n'));
    console.log(`\n项目文件: ${storage.paths(project.id).projectFile}`);
}

main().catch(error => {
    console.error(`冒烟测试失败: ${error.message}`);
    process.exit(1);
});
