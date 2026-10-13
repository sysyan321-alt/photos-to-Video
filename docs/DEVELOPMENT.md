# 生长相册 GrowAlbum · AIGC 个人影像工坊

把一句话创意跑成 **15 秒 / 1080×1920 竖屏 / MP4** 的漫剧草稿。这是按 `ComicDrama.md`
搭的骨架的第一条完整链路：**创意 → Brief → 剧本 → 角色卡 → 分镜表 → 关键帧 → 轻动态镜头 → 音轨 → 合成导出**。

其中「一句话创意」是**独立模块**：可以先只做创意解析，得到结构化 Brief（题材 / 基调 / 钩子 / 关键词 / 标题），
人工改完再决定要不要开项目；也可以直接把 `brief` 或 `briefId` 交给建项目接口。创意解析和项目生产因此解耦，
同一个 Brief 能复用给多个项目（例如同一创意换画风各出一版）。

## 快速开始（Docker）

```bash
cd photos-to-Video
cp env.example.yaml env.yaml     # 可选：不填 Key 就是离线兜底模式
docker compose up -d --build
open http://localhost:8787
```

成片与中间产物落在宿主机 `photos-to-Video/data/growalbum/projects/<项目ID>/`。

## 运行模式

整条链路是「模型可插拔 + 离线兜底」，三类模型任填其一即可：

| 环节 | 配了模型 | 没配模型（默认） |
| --- | --- | --- |
| 编剧 / 分镜 | 文本模型输出 JSON 剧本与分镜 | 内置叙事节拍模板拆解创意 |
| 关键帧 | 图像模型按提示词出 9:16 关键帧，或直接用相册照片裁切 | ffmpeg 渲染的面板占位 |
| 音轨 | TTS 按镜头配音（含情绪提示） | ffmpeg 合成的环境音床 |

所以**没有任何 Key 也能一键出片**，方便先验收链路；填上 Key 后同一套流程自动升级成真实素材。

## 接口

完整接口契约见 [`docs/API.md`](./API.md)。所有异步动作都是同一形状：
**提交 → 202 + `jobId` → `GET /api/jobs/:id` 查进度 → `POST /api/jobs/:id/cancel` 取消**，
便于被脚本或 Agent 框架当成工具调用。

## 目录结构

```
photos-to-Video/
├── src/
│   ├── config.js            # 环境变量 / env.yaml 配置
│   ├── index.js             # 启动、路由挂载、静态资源
│   ├── http/                # 微型 router + 路由表（含 Range 文件响应）
│   ├── domain/              # brief 创意模型、project 数据模型、jobs 任务模型
│   ├── agents/              # 创意解析 / 总控制片 Agent
│   ├── services/            # gallery / llm / image / tts / vision / ffmpeg / storage / cache / batch
│   ├── providers/           # 四类模型的厂商适配器与注册表
│   └── workflow/            # 工作流引擎 + 节点库 + 内置模板
├── web/                     # 控制台（创作台、相册、提示词库、作品、批量、数据、模型接入）
├── Dockerfile
└── docker-compose.yml
```

架构说明见 [docs/ARCHITECTURE.md](ARCHITECTURE.md)，接口契约见 [docs/API.md](API.md)，
产品现状与未实现清单见 [docs/PRODUCT.md](PRODUCT.md)。

## 已验证的成片参数

- 分辨率 1080×1920（9:16），25fps，H.264 + AAC
- 时长 15 秒 = 5 个镜头 × 3 秒
- 每镜头带 Ken Burns 轻动态 + 烧录字幕；无中文字体时自动跳过文字层

改镜头数或时长：调 `Comic-Shot-Count` / `Comic-Shot-Seconds`，总时长会自动跟着变。
