# 生长相册 GrowAlbum 架构说明

## 分层

```
web/ 控制台
   ↓ HTTP
http/routes.js       路由表：创意、提示词库、相册、项目、工作流、任务、文件
   ↓
agents/idea.js       创意 Agent：一句话创意 → Brief（独立模块，可脱离项目使用）
   ↓
agents/producer.js   总控 Agent：立项 + 调度「前期」节点链
   ↓
workflow/            工作流引擎
  ├─ templates/      声明式模板（vertical-15s / album-mv-15s）
  ├─ nodes/          节点库（每个节点带 requires/produces/canRun/run/fallback）
  └─ engine.js       按产物可用性校验并执行，记录 nodeRuns、支持单节点重跑
   ↓
providers/           Provider 注册表：llm | image | tts（换厂只改注册表一行）
   ↓
services/*           ffmpeg | storage | gallery（相册） | llm/image/tts 实现
   ↓
domain/*             brief 创意模型 · preset 提示词库 · gallery 相册 · project · jobs
```

### 节点契约

```
requires / produces                声明产物依赖（数组可写 OR 组，如 [['keyframe@shot','clip@shot']]）
canRun(ctx)   -> { ok, reason }    前置校验：缺 Key、缺上游产物、参数非法
run(ctx)      -> { detail, degraded, cost, warnings }
fallback(ctx) -> { assets, degraded }
```

引擎按「产物是否可得」推演整条链：上游节点被删/被停用且项目里也没有对应产物时会直接拦下并给出原因，
所以自定义工作流不会搭出跑不通的链。

### 已实现的模块

| 模块 | 位置 | 状态 |
| --- | --- | --- |
| Provider 注册表 | `src/providers/` | ✅ gemini(llm/image) / indextts |
| 工作流引擎 + 节点库 | `src/workflow/` | ✅ 11 个节点、2 个内置模板、单节点重跑 |
| 创意模块 | `src/agents/idea.js` + `src/domain/brief.js` | ✅ 独立可用 |
| 提示词库 + 槽位组装 | `src/domain/preset.js` + `prompt-assembly` 节点 | ✅ 6 个槽位分组、21 条内置预设 |
| 个人相册 + 相册 MV | `src/services/gallery.js` + `album_mv` 节点 | ✅ 上传/分组/缩略图/一键出片 |

## 创意模块为什么独立

`agents/idea.js` + `domain/brief.js` 只做一件事：把非结构化的「一句话创意」变成结构化 Brief。

- 对上游：创意可以先解析、人工编辑、存档，不创建任何项目（`POST /api/ideas`）。
- 对下游：编剧/分镜/美术只消费 Brief 字段（`toPromptText`），不再直接读取用户的原始句子，因此这三个 Agent 的输入是稳定契约。
- 对复用：同一个 Brief 可以派生多个项目（换画风、换镜头数），项目里也保存了一份 `brief.json` 快照，保证可回溯。

## 与 ComicDrama.md 的对应关系

| ComicDrama.md | 本仓库实现 | 状态 |
| --- | --- | --- |
| 4.1 总控 Agent（制片人） | `agents/producer.js` | MVP：顺序调度，已具备项目落库 |
| 2.4 创建项目（创意入口） | `agents/idea.js` + `domain/brief.js` | 已拆成独立模块，可先解析再立项 |
| 4.3.1 编剧 Agent | `agents/script.js` | 已实现（模型 + 离线双通道） |
| 4.3.3 分镜 Agent | `agents/storyboard.js` | 已实现（输出 5 镜头 / 15 秒） |
| 4.3.4 美术 Agent | `workflow/nodes/prompt-assembly.js` + `domain/preset.js` | 已实现（槽位组装 + 调色板 + 风格预设） |
| 4.3.5 动态视频 Agent | `services/ffmpeg.js` 的 zoompan 轻动态 | MVP：Ken Burns 推拉摇移 |
| 4.3.6 音频 Agent | `services/tts.js` + 环境音床兜底 | 已实现 |
| 4.3.7 剪辑合成 Agent | `workflow/nodes/compose.js` | 已实现（字幕烧录 + 音画对齐 + faststart） |
| 5.5 数据模型 | `domain/project.js` | 已覆盖 Project/Character/Shot/Asset/Job |
| 6.x 工作台页面 | `web/` | MVP 单页：创意、分镜表、预览、任务日志 |

## 关键设计决策

1. **离线兜底**：每个模型适配器都能独立降级，因此没有 Key、没有网络也能跑通端到端并产出可播放成片。
2. **提示词落盘**：每个镜头的关键帧提示词写入 `keyframes/<shot_id>.prompt.txt`，便于人工复核与后续接 LoRA / 参考图。
3. **产物即数据**：项目目录结构固定（`keyframes/ clips/ audio/ video/ output/`），JSON 与素材一一对应，方便后续接数据库只替换 storage 层。
4. **零 npm 依赖**：容器构建不需要 npm registry，仅依赖系统 ffmpeg 与字体。

## 下一步扩展点

- 角色一致性：把 `characters[].reference_prompt` 接入参考图模式，按角色固定 seed / LoRA。
- 图生视频：在 `renderClips` 前插入 I2V 适配器（可灵 / 即梦 / Runway），失败自动回落到 zoompan。
- 任务队列：`domain/jobs.js` 换成持久化队列 + 并发控制，支撑批量生产。
- 审核与运营 Agent：在 `pipeline` 末尾追加审核步骤与发布包生成，接口形状已经预留。
