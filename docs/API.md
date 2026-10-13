# 接口契约（GrowAlbum HTTP API）

生长相册是本地单机服务，默认监听 `http://localhost:8787`，**不带鉴权**，请勿直接暴露到公网。
所有请求与响应都是 UTF-8 JSON（照片上传例外，见 4.2）。

## 通用约定

- 成功：`2xx` + `{"success": true, ...}`；失败：`{"success": false, "message": "…"}`。
  `message` 是面向人的中文说明，前端直接展示，因此不要用状态码代替。
- 状态码约定：

  | 状态码 | 含义 |
  | --- | --- |
  | 200 | 同步完成（含「无事可做」，例如所有照片都已打过分） |
  | 201 | 资源已创建（项目、相册、预设） |
  | 202 | 已接受，返回 `jobId`，后续用任务接口查进度 |
  | 400 | 参数不合法，或模型调用失败（`message` 里是原因） |
  | 403 | 读取的路径不在产物根目录内 |
  | 404 | 资源不存在 |
  | 409 | 状态冲突（项目正在渲染时不可删除 / 不可重跑） |

- 产物读取统一走 `GET /api/files?path=<产物路径>&download=1`，支持 `Range`，
  所以 `<video>` 可以直接拖动进度条。
- 付费节点的花费会累加进项目的 `spend.yuan`；预算上限由环境变量 `COMIC_BUDGET_YUAN` 控制，
  `0` 或未设置表示不限制。超预算时节点在调用前中止，不产生费用。

## 异步任务模型

凡是会调用模型或跑 ffmpeg 的动作，形状都是同一套 —— 提交、轮询、可取消：

```
POST /api/projects/:id/render        -> 202 { jobId }
GET  /api/jobs/:jobId                -> 200 { job }   （status / progress / steps / logs）
POST /api/jobs/:jobId/cancel         -> 200 { jobId, status }
```

`job` 结构：

```json
{
  "id": "job_mv6sii4t279815",
  "kind": "render",
  "projectId": "cd_mv68yyy7_8363",
  "status": "queued | running | succeeded | failed | canceled",
  "progress": 0,
  "steps": [
    { "name": "keyframe", "status": "pending", "detail": null, "startedAt": null, "finishedAt": null }
  ],
  "logs": [{ "at": "2026-10-13T14:41:18.974Z", "message": "▶ 关键帧" }],
  "result": null,
  "error": null,
  "createdAt": "2026-10-13T14:41:18.968Z",
  "updatedAt": "2026-10-13T14:41:19.947Z"
}
```

- `steps[].detail` 写的是这一节点实际做了什么，例如 `相册照片 5`、`模型出图 5（缓存命中 3）`、
  `配音 5 段 + BGM(test-tone.mp3)，带 ducking`、`1080x1920 / 15s / 7.28MB（5 个镜头轻动态）`。
- 打分任务（`kind: "score"`）额外带 `total` / `done` / `items[]`，取消后会保留已打出的分数。
- 任务快照落在项目目录的 `job.json`，容器重启后批次任务会接着跑。
- **批量生产的队列是串行的**：`kind: "batch"` 由 `GET /api/batch/:id` 查看，不占用 `jobId`。

## 1. 系统与配置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | ffmpeg 版本、字幕可用字体、运行时长、四环节模型状态 |
| GET | `/api/config` | 成片规格、产物根目录、运行模式（offline / hybrid / full-model） |
| GET | `/api/providers` | 当前四环节的 provider 描述 + 可选厂商目录 |
| GET | `/api/config/providers` | 模型接入页数据：每环节的厂商、模型、可用性、已存 Key（掩码） |
| POST | `/api/config/providers` | 保存某环节配置并**热加载**（不用重启容器） |
| POST | `/api/providers/:kind/test` | 只读连通性自检，不消耗生成额度 |

`kind` 取 `llm` / `image` / `i2v` / `tts`。保存时字段全部可选，空字符串表示「不改动」：

```bash
curl -X POST http://localhost:8787/api/config/providers \
  -H 'Content-Type: application/json' \
  -d '{"kind":"i2v","provider":"aliyun","model":"vidu/viduq3-pro-fast_img2video","size":"540*960"}'
```

自检失败也是 `200`，失败原因在 `result.message` 里（避免与真正的接口错误混淆）：

```json
{ "success": true, "result": { "ok": false, "message": "HTTP 401" } }
```

## 2. 创意（一句话 → Brief）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ideas` | `{idea, title?}` → 解析出创意简报，**不**创建项目 |
| GET | `/api/ideas` | 历史简报列表 |
| GET | `/api/ideas/:id` | 单条简报 |
| POST | `/api/ideas/:id` | 修改简报，并把改动同步到引用它的项目 |

## 3. 提示词库（预设）

预设按 6 个槽位分组，顺序固定为
`style`（画风）→ `consistency`（一致性）→ `scene`（场景）→ `camera`（运镜）→ `lighting`（光效）→ `extra`（补充），
另有 `negative`（负面）与 `audio`（音频情绪）两个标签用于其它环节。
`GET /api/presets` 会一并返回 `slotOrder`、`slotLabels` 与分组后的 `groups`（`[{slot, label, items}]`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/presets` | 全部预设（含内置）+ 分组结构 |
| POST | `/api/presets` | 新建，`id` 重复返回 409 |
| POST | `/api/presets/:id` | 修改（内置预设同样可改文本） |
| DELETE | `/api/presets/:id` | 删除；内置预设返回 400，建议改为停用 |
| GET | `/api/presets/export` | 导出为可分享的 JSON 包 |
| POST | `/api/presets/import` | `{presets: [...]}` 导入，同名 id 视为更新文本 |
| POST | `/api/presets/from-image` | **风格反推**：`{photoId}` 或 `{path}` → 视觉模型描述 → 落成 style 预设 |

## 4. 个人相册

### 4.1 相册与照片

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/gallery/albums` | 相册列表（含照片数、封面） |
| POST | `/api/gallery/albums` | `{name, description?, tags?}` → 201 |
| DELETE | `/api/gallery/albums/:id` | 删相册连同其照片（不可恢复） |
| GET | `/api/gallery/albums/:id/photos` | 相册内照片（含 `score` / `reason` / `scoredAt`） |
| POST | `/api/gallery/albums/:id/photos?name=&note=&source=` | 上传单张，**请求体就是文件二进制** |
| POST | `/api/gallery/photos/:id` | 改备注 / 标签 / 封面 |
| DELETE | `/api/gallery/photos/:id` | 删单张 |

上传示例（前端逐张并发上传，靠这个接口避开 multipart 依赖）：

```bash
curl -X POST "http://localhost:8787/api/gallery/albums/alb_mv5da1o0_3b05/photos?name=IMG_0001.jpg&note=西湖荷花&source=upload" \
  -H 'Content-Type: application/octet-stream' --data-binary @IMG_0001.jpg
```

### 4.2 让模型看照片

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/gallery/albums/:id/score` | **打分任务化**：`{purpose?, onlyUnscored?, limit?}` → 202 + `jobId`；分数回写到照片。全部已打分时返回 200 |
| POST | `/api/gallery/albums/:id/pick` | 同步打分并排序：`{count?, limit?, purpose?}` → `{ranked, top}`（适合人工挑选，张数由 `limit` 控制成本） |
| POST | `/api/gallery/albums/:id/story` | **相册 → 故事**：`{shots?, createProject?, templateId?}` → 模型读图写剧本，`createProject: true` 时直接立项并把画面来源绑到本相册 |
| POST | `/api/gallery/albums/:id/mv` | **一键出片**：`{title?, pick?: sequential\|random\|score, caption?: note\|none}` → 202 + `projectId`，整条链路不调图像/视频模型（0 元） |

## 5. 项目与工作流节点

### 5.1 立项、重跑与编排

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 项目列表（含海报、首帧缩略图，作品页用） |
| POST | `/api/projects` | `{idea}` 或 `{brief}` / `{briefId}`，`{title?, templateId?}` → 201 `{project}`（**同步跑完前期链路**，约 60~70 秒） |
| GET | `/api/projects/:id` | 项目全量详情（分镜、关键帧、产出、花费、发布包） |
| DELETE | `/api/projects/:id` | 删项目与产物；渲染中返回 409 |
| POST | `/api/projects/:id/preproduction` | 用当前或传入的 Brief 重跑前期链路，项目 ID 与创意保留 |
| POST | `/api/projects/:id/render` | 启动渲染，202 + `jobId`；先做工作流校验，失败返回 400 |
| POST | `/api/projects/:id/nodes/:nodeId/rerun` | 只重跑一个节点（改一处别整集重做） |
| GET | `/api/projects/:id/download` | 下载成片 MP4 |

### 5.2 画面来源与参考图

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/projects/:id/use-album` | `{albumId, pick?}` → 把相册设为画面来源，逐镜头绑定照片（只跑 `image_source` 节点，毫秒级、不调模型） |
| POST | `/api/projects/:id/refs` | `{photoIds: [≤3]}` → 绑定角色参考图，图生视频阶段作为多图参考 |
| POST | `/api/projects/:id/nodes/:nodeId/params` | `{params?, enabled?}` → 改节点参数 / 启停（提示词槽位选择走这里） |
| POST | `/api/projects/:id/workflow/nodes` | `{nodes: [{id, enabled?, params?}]}` → 整条链的顺序与增删（工作流编辑器保存用） |
| POST | `/api/projects/:id/shots/:shotId` | `{prompt_slots?, reset_slots?, caption?, camera?, visual_desc?}` → 单镜头微调 |

### 5.3 人工闸门（草稿 → 筛选 → 精修）

用 `draft-select-refine` 模板跑渲染时，生成完风格变体后项目会停在 `awaiting_selection`，
`project.variants[]` 里是候选方向，不会有成片：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/projects/:id/selection` | `{variantId}` → 选定方向，把它的关键帧提为正式关键帧，状态回到 `storyboard_ready`，再调 `/render` 继续 |

### 5.4 质量与出品

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/projects/:id/review` | 视觉审核：一次调用同时判合规风险与图文一致性 |
| POST | `/api/projects/:id/consistency-check` | `{threshold?: 6, limit?: 10}` → 关键帧与角色参考图比对，列出「跑样」镜头 |
| POST | `/api/projects/:id/publish` | `{platform?}` → 标题/简介/标签/封面文案 + AI 生成标识，并把标识写进成片元数据 |
| POST | `/api/projects/:id/metrics` | 回填投放数据（播放量 / 完播率 / 点赞） |

## 6. 工作流模板

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workflows` | 模板列表 + 默认模板 |
| GET | `/api/workflows/:id` | 模板详情（节点、连线、参数） |
| GET | `/api/workflow/nodes` | 节点库清单（工作流编辑器「添加节点」的数据源） |
| POST | `/api/workflows` | `{projectId, name?, description?}` → 把项目当前编排固化成可复用模板 |
| POST | `/api/workflows/:id` | 改自定义模板的名字 / 描述 |
| DELETE | `/api/workflows/:id` | 删自定义模板；内置模板返回 400 |

## 7. 批量生产

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/batch` | `{ideas: [...]}` 或 `{text: "一行一条"}`，最多 20 条 → 202 `{batchId, count, items}` |
| GET | `/api/batch` | 批次列表（状态、条数、累计花费） |
| GET | `/api/batch/:id` | 批次详情，逐条进度；重启后自动续跑未完成项 |

## 8. 数据闭环

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/analytics/presets?slot=style` | 预设效果排行（按回填数据算平均分） |
| GET | `/api/analytics/recommend?slot=style&limit=3` | 推荐组合 + 依据（样本量），前端一键应用回项目槽位 |

## 9. 任务与文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/jobs?projectId=` | 任务列表（可按项目过滤），最新在前 |
| GET | `/api/jobs/:id` | 单个任务状态、步骤、日志、结果 |
| POST | `/api/jobs/:id/cancel` | 请求取消；批处理类任务在下一张/下一节点前停下 |
| GET | `/api/files?path=<产物路径>&download=1` | 读产物，支持 Range；越界返回 403 |

## 一份「最省钱的相册出片」调用序列

下面这条序列除了打分（可选）之外全程 0 元，适合先跑通链路：

```bash
BASE=http://localhost:8787

# 1) 建相册 + 传图
ALBUM=$(curl -s -X POST $BASE/api/gallery/albums -H 'Content-Type: application/json' \
  -d '{"name":"西湖周末"}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -X POST "$BASE/api/gallery/albums/$ALBUM/photos?name=a.jpg&note=荷花" \
  -H 'Content-Type: application/octet-stream' --data-binary @a.jpg > /dev/null

# 2) 可选：让模型按用途打分（0.02 元/张，可只补未打分的）
JOB=$(curl -s -X POST $BASE/api/gallery/albums/$ALBUM/score \
  -H 'Content-Type: application/json' -d '{"onlyUnscored":true}' \
  | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
curl -s $BASE/api/jobs/$JOB          # 轮询到 succeeded / canceled

# 3) 相册 → 故事 → 立项（模型读图，约 105 秒）
PROJ=$(curl -s -X POST $BASE/api/gallery/albums/$ALBUM/story \
  -H 'Content-Type: application/json' -d '{"shots":5,"createProject":true}' \
  | grep -o '"id":"cd_[^"]*"' | head -1 | cut -d'"' -f4)

# 4) 画面来源确认为相册照片（按分数取图）
curl -s -X POST $BASE/api/projects/$PROJ/use-album -H 'Content-Type: application/json' \
  -d "{\"albumId\":\"$ALBUM\",\"pick\":\"score\"}"

# 5) 关掉图生视频（不花钱），再渲染
curl -s -X POST $BASE/api/projects/$PROJ/nodes/shot_video/params \
  -H 'Content-Type: application/json' -d '{"enabled":false}' > /dev/null
JOB=$(curl -s -X POST $BASE/api/projects/$PROJ/render | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
curl -s $BASE/api/jobs/$JOB

# 6) 下载
curl -s -o out.mp4 "$BASE/api/projects/$PROJ/download"
```

## 兼容性说明

- 环境变量与 `env.yaml` 键名沿用历史前缀（`COMIC_*` / `Comic-*`）。
  重命名会让既有 `env.yaml` 静默失效，因此暂不改动 —— 改的话需要同时提供旧名回退。
- 异步任务一律是「提交 → 202 → 轮询 → 可取消」，这个形状是刻意保留的：
  它可以直接当成 Agent 框架（LangGraph 等）里的一个 tool 来编排。
