# 贡献指南

欢迎提交 Issue 与 Pull Request。本文说明如何把项目跑起来、代码放在哪、以及改动的注意事项。

## 环境要求

- Node.js 18+（生产环境用 Docker 自带的 Node 20）
- Docker（推荐，镜像内已包含 ffmpeg 与中文字体）
- 不引入 npm 依赖：后端零依赖，前端直接用浏览器原生 ESM 加载 Vue，**没有构建步骤**

## 本地跑起来

```bash
cp env.example.yaml env.yaml     # 填模型 Key；未填时系统进入离线兜底模式，仍可出片
docker compose up -d --build
# http://localhost:8787
```

不开 Docker（仅跑前期链路、不做渲染）：

```bash
npm run smoke "一句创意"     # 创意 → 剧本 → 分镜 → 提示词（不需要 ffmpeg）
```

## 代码结构

```
src/
  providers/   模型注册表：llm | image | i2v | tts，一个厂商一个适配器
  workflow/    工作流引擎 + 节点库 + 模板（节点声明 requires/produces/canRun/run/fallback）
  agents/      创意 Agent、总控 Agent
  services/    相册、提示词库、缓存、成本护栏、视觉理解、分析、批量、ffmpeg
  domain/      数据模型与纯函数（brief / preset / gallery / project / jobs / pricing）
web/           Vue 3 单页应用（components / views / panels）
scripts/       冒烟测试、前端模块自检、接口探活
```

## 常见改动的做法

**加一个模型厂商**：在 `src/providers/<kind>/` 下新建适配器，实现 `create(config)` 并返回
`{ id, label, enabled, canRun, estimateCost, run }`（文本/图像/配音另需 `generateText|generateImage|synthesize`），
然后在 `src/providers/registry.js` 的 `CATALOG` 里注册一行。定价写进 `src/domain/pricing.js`。

**加一个工作流节点**：在 `src/workflow/nodes/` 新建文件，声明 `requires / produces / canRun / run`，
在 `nodes/index.js` 注册，再在模板里按需启用。引擎会按「产物是否可得」做契约校验。

**改前端**：`web/src/` 下按 components（通用组件）/ views（页面）/ panels（工作区面板）分层。
提交前跑 `node scripts/check-web.js`，它会校验模块图与 import 路径。

## 提交前必做

```bash
node scripts/check-web.js        # 前端模块图
node --check src/index.js        # 后端语法（改过的文件都过一遍）
docker compose up -d --build && docker compose ps   # 确认容器是 Up 而不是 Restarting
```

改到模板渲染时，建议再用无头浏览器读一次 DOM，确认关键元素真的渲染出来了——静态检查发现不了
「模板引用了实例上不存在的东西」这类问题。

## 提交规范

- 提交信息用 Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`
- 一个提交只做一件事，附带"为什么"而不只是"做了什么"
- 不要提交 `env.yaml`、`data/`、任何 API Key（`.gitignore` 已覆盖，请勿用 `git add -f` 绕过）

## Pull Request

1. 从 `main` 切分支，命名如 `feat/album-filter` 或 `fix/keyframe-count`
2. 说明改了什么、为什么、怎么验证的（贴关键日志或输出）
3. 涉及模型调用的改动，请说明对**成本**的影响（本项目所有付费调用都应有估算与护栏）

## 设计约定

改动前请先读 `docs/PRODUCT.md` 的「设计原则」。核心五条：

1. 流程固定、节点可见（不做自由连线的节点图）
2. 任何模型不可用都要能出片，并标明降级原因
3. 花钱有护栏：调用前估算、超预算中止、逐条记账
4. 内容哈希缓存贯穿关键帧 / 视频 / 配音，重跑不重复付费
5. 未实现的能力写进文档，而不是留给用户去发现
