# 生长相册 GrowAlbum · AIGC 个人影像工坊

把一句话创意跑成 **15 秒 / 1080×1920 竖屏 / MP4** 的漫剧草稿。这是按 `ComicDrama.md`
搭的骨架的第一条完整链路：**创意 → Brief → 剧本 → 角色卡 → 分镜表 → 关键帧 → 轻动态镜头 → 音轨 → 合成导出**。

其中「一句话创意」是**独立模块**：可以先只做创意解析，得到结构化 Brief（题材 / 基调 / 钩子 / 关键词 / 标题），
人工改完再决定要不要开项目；也可以直接把 `brief` 或 `briefId` 交给建项目接口。创意解析和项目生产因此解耦，
同一个 Brief 能复用给多个项目（例如同一创意换画风各出一版）。

## 快速开始（Docker）

```bash
cd comicdrama
cp env.example.yaml env.yaml     # 可选：不填 Key 就是离线兜底模式
docker compose up -d --build
open http://localhost:8787
```

成片与中间产物落在宿主机 `comicdrama/data/comicdrama/projects/<项目ID>/`。

## 运行模式

整条链路是「模型可插拔 + 离线兜底」，三类模型任填其一即可：

| 环节 | 配了模型 | 没配模型（默认） |
| --- | --- | --- |
| 编剧 / 分镜 | Gemini 文本模型输出 JSON 剧本与分镜 | 内置漫剧节拍模板拆解创意 |
| 关键帧 | Gemini/NanoBanana 按提示词出 9:16 关键帧 | ffmpeg 渲染的漫画分镜面板占位 |
| 音轨 | IndexTTS-2 按镜头配音（含情绪提示） | ffmpeg 合成的环境音床 |

所以**没有任何 Key 也能一键出片**，方便先验收链路；填上 Key 后同一套流程自动升级成真实素材。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | ffmpeg 版本、字幕字体、模型开关状态 |
| GET | `/api/config` | 当前成片规格与运行模式 |
| POST | `/api/ideas` | `{idea}` → 创意模块解析出 Brief（不创建项目） |
| GET | `/api/ideas` · `/api/ideas/:id` | 列出 / 读取历史 Brief |
| POST | `/api/projects` | `{idea}` 或 `{brief}` / `{briefId}` → 创建项目并生成剧本/分镜/关键帧提示词 |
| GET | `/api/projects` | 项目列表 |
| GET | `/api/projects/:id` | 项目详情（含分镜表与产物路径） |
| POST | `/api/projects/:id/render` | 启动渲染任务，返回 `jobId` |
| GET | `/api/jobs/:id` | 任务进度、步骤状态、日志 |
| GET | `/api/projects/:id/download` | 下载成片 MP4 |
| GET | `/api/files?path=` | 读取产物（支持 Range，供 `<video>` 拖动） |

## 目录结构

```
comicdrama/
├── src/
│   ├── config.js            # 环境变量 / env.yaml 配置
│   ├── index.js             # 启动、路由挂载、静态资源
│   ├── http/                # 微型 router + 路由表（含 Range 文件响应）
│   ├── domain/              # brief 创意模型、project 数据模型、jobs 任务模型
│   ├── agents/              # 创意 / 总控 / 编剧 / 分镜 / 美术 Agent
│   ├── services/            # llm / image / tts / ffmpeg / storage 适配层
│   └── pipeline/            # generateMvp：15 秒成片流水线
├── web/                     # 控制台（创意输入、分镜表、预览、任务日志）
├── Dockerfile
└── docker-compose.yml
```

架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

> 下一步改造方案（固定工作流 + 提示词菜单栏 + 自接 API Key）见
> [docs/WORKFLOW-PLAN.md](docs/WORKFLOW-PLAN.md)，尚未实施。

## 已验证的成片参数

- 分辨率 1080×1920（9:16），25fps，H.264 + AAC
- 时长 15 秒 = 5 个镜头 × 3 秒
- 每镜头带 Ken Burns 轻动态 + 烧录字幕；无中文字体时自动跳过文字层

改镜头数或时长：调 `Comic-Shot-Count` / `Comic-Shot-Seconds`，总时长会自动跟着变。
