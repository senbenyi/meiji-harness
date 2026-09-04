# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库边界

- Git 仓库根是 `llm-dsh-plugins`；**`dsh-elysium/` 只是子目录，不是独立仓库**。提交、`.dsh/skills` 技能发现(取最近 `.git` 祖先、只扫一层)都以仓库根为准。
- `dsh-elysium` 是唯一安装单元，已内置远程 ComfyUI 驱动与侧边栏，不再需要 `dsh-comfyui` / `dsh-better-sidebar`。
- 兄弟仓库 `../llm-ai-model` 是**模型能力层**(在 autodl 上部署/运行模型、ComfyUI 工作流、capability runner)。**业务编排能力属于本插件**，不要把剧集/分镜/调度逻辑写进 `llm-ai-model`。

## 常用命令

全部在 `dsh-elysium/` 下执行：

```sh
pnpm install
pnpm typecheck                              # tsc --noEmit
pnpm test                                   # node --test tests/*/*.test.js
node --test tests/production/planner.test.js   # 跑单个测试文件
pnpm build                                  # 清 lib/ + tsc -p tsconfig.build.json + tsdown
pnpm check:source-imports                   # 校验分层依赖方向(见下)未被破坏
pnpm check:consumer-types                   # 校验对外类型出口
```

日常开发用监听器，**不要**每次改动都 `pnpm build` 或重装插件(见 `dsh-elysium/AGENTS.md`)：

```sh
pnpm dev:ui        # 监听前端，直接更新 registry/lib/client-registry.js，刷新浏览器即可
pnpm dev:server    # 监听服务端，更新 registry/lib/index.js 并自动重启 dsh web
curl -sS -X POST http://127.0.0.1:3080/elysium/api/project.list \
  -H 'content-type: application/json' --data '{}'    # 服务端改动的轻量健康检查
```

`pnpm release:local` 只用于首次安装、安装损坏或完整交付；执行前先 Ctrl-C 停掉两个监听器。

**`lib/` 和 `registry/` 是生成目录(已 gitignore)，绝不手改；源码只在 `src/`。**

## 架构

产品主线：**故事 → 剧本与资产 → 长视频章节规划 → 文生图起始帧 → 后续关键帧 → 章节长视频 → 成片 → 人工终审**。用户一次授权后系统自动跑到终审，只在无法自动恢复时进入"需要处理"。

分层与依赖方向由 `scripts/check-source-imports.mjs` 强制(`domain` 不得引用任何上层；`application` 不得引用 `bootstrap`/`presentation`/`public`；`infrastructure` 不得引用 `application`)：

| 层 | 关键文件 | 职责 |
|---|---|---|
| `src/domain/` | `episode.js` | 实体规则与**依赖失效传播**，纯逻辑无 I/O |
| `src/application/` | `planning-service.js` | Producer Agent：经 `ctx.llm.stream` 把故事转成章节规划，JSON 校验 |
| | `production-service.js` | Episode Orchestrator：持久化任务队列、依赖拓扑调度、重试、产物版本 |
| | `legacy-factory-service.js` | 旧 `vmp-1` 兼容实现(FFmpeg 拼接 / FFprobe 时长 / 成片哈希人审) |
| `src/infrastructure/` | `comfyui/` | 远程 ComfyUI 合同驱动(纯 HTTP) |
| | `persistence/store.js` | 原子 JSON 写入与路径约束 |
| `src/presentation/dsh/` | `studio-host.js` | `/elysium/api` 路由 + 唯一聊天工具 `_dsh_external_dsh_elysium_factory`(一个 `action` 参数分发到各用例) |
| `src/bootstrap/` | `plugin.ts` | 唯一组合根 |

必须遵守的运行时约束(详见 `docs/elysium-technical-design.md`)：

- 每章**恰好 6 个有序锚点**：第 1 个 `role=start`(文生图起始帧)，其余 5 个 `role=continuation`；起始帧属于这 6 个，不额外加输入。
- 产物**只追加版本**，`adoptedVersionId` 决定当前采用；`inputHash`(模板版本+提示词+参数+种子+上游采用版本)决定复用与失效。
- 所有单集写操作走 `episodeId` 级互斥锁；先持久化 `queued` 再提交远端，拿到 `remoteJobId` 立即持久化；重启时按远端历史恢复，不以进程内 `Map` 为真相。
- 技术 QC 通过只能进入 `awaiting_review`；人工终审绑定当前成片哈希后才能 `approved`。
- 存储在 `elysium-workspace/projects/<projectId>/episodes/<episodeId>/{episode,script,assets,plan,state,tasks,issues}.json` + `artifacts/{anchors,chapters,final}/`。

### ComfyUI 合同

`templates/comfyui/` 下每个工作流是一对文件：`<id>.json`(工作流图) + `<id>.contract.json`(声明 `slots` 到 `node`/`field` 的映射、`capabilities`、`models`、`loras`)。驱动**只执行合同**，不即兴改图。新增工作流改根目录 `templates/`；`registry/templates/` 与 `elysium-workspace/comfyui/templates/` 分别是打包产物和运行时副本，不是源。

### 需要注意的历史包袱

- `/factory.execute` 与旧 `vmp-1` JSON 是兼容入口(`legacy-factory-service.js` 里 `SHOT_COUNT = 2`)，新 UI 已不用；**不要在 vmp-1 上做新功能**，新流程走 project/episode 模型。
- 规划走 provider `qwen38-local` / model `qwen3.8-27b-video-prompt`，每次调用最多 5 章、每章 20 秒。
- 插件**不跑 Python、不含 SSH 依赖**：只 spawn `ffmpeg`/`ffprobe`，远程 ComfyUI 一律走 `comfyui.baseUrl`(默认 `http://127.0.0.1:8189`)的 HTTP，隧道由用户自己维护。

## 验证纪律

静态检查、测试、构建、安装、服务启动、GPU 端到端是**不同层级**；交接时只报告实际跑到的层级(`dsh-elysium/AGENTS.md`)。小改动优先跑相关测试 + `git diff --check`，不要默认走完整发布流程。
