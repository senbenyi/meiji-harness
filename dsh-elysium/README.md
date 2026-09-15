# dsh-elysium

视频生成插件。提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及任务恢复。

## 源码结构

```text
src/
├── business/                 # 内部业务包，随插件一起构建和发布
│   ├── projects/             # 项目、锚点、分镜与交付数据
│   ├── directors/            # 导演库
│   ├── assets/               # 素材查询与访问校验
│   ├── jobs/                 # 任务持久化、查询、诊断与进程锁
│   ├── video/                # 单次视频任务、执行、worker 与恢复
│   └── production/           # 多镜头生产清单、编排、回执与参考帧
├── servers/                  # 服务器发现、配置、连接与平台适配
│   └── providers/            # 平台实现及各自的工作流模板
│       └── runpod/workflows/ # 原有 H3 图构建、档位配置和完整模板
├── comfyui/                  # 公共 ComfyUI 协议、提交与媒体引用
├── tools/                    # Harness 聊天工具入口
├── http/                     # HTTP 路由适配
├── client/                   # 创作工作台与聊天界面
├── prompts/                  # 系统提示词
├── config.js                 # 插件运行配置
└── index.js                  # 插件装配入口
```

业务集中在 `business/`，各子模块保留职责边界；聊天工具和 HTTP 路由调用同一套业务代码。服务器选择由 `servers/` 负责，原有 H3 模板与实现由 Runpod 模块管理，其他平台提供自己的模板。`business/` 是插件内部源码包，不单独安装或发布。

构建将 `src/` 复制到 `lib/`，客户端单独生成；`business/production/` 沿用源码 CLI 运行方式，不进入发布包。生产命令入口仍为 `scripts/production-runner.mjs`。目录迁移不改变项目与任务在存储中的路径。

## 短剧快速预览

调用 `workflow_generate_video` 时传入所属项目的 `project_id` 并增加 `profile: "preview"`，支持 `t2va` 或带 `first_frame` 服务器图片 URL 的 `i2va`。当前预览为 H3、384×512、73 帧、24fps、8 步，约 3.04 秒，保留联合音频并跳过 RIFE。省略 profile 或使用 `standard` 恢复原工作流。

配置位于 `src/servers/providers/runpod/workflows/minimax-h3/profiles/preview.json`；具体验收、三镜头样片、恢复方式及限制见 [快速预览说明](../docs/implement/实施-AI短剧快速预览.md)。

## 构建

本地构建需要 Node.js 20.16+ 和 pnpm。运行视频生成或同步工作流时，需要选中已提供 MiniMax H3 工作流的 ComfyUI 服务。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
```

插件的 Cordis 装配位于 `harness/.dsh/profiles/web/cordis.patch.yml`。在仓库根目录使用统一部署脚本安装 Harness 配置和插件依赖：

```sh
node harness/scripts/install.mjs
```

## 工作流同步

`src/servers/providers/runpod/workflows/minimax-h3/templates/` 是五套 MiniMax H3 UI/API 图及 Harness 绑定的唯一事实源。

```sh
pnpm workflow:sync       # 从当前选中平台的 ComfyUI 同步 UI 图，编译 API 图并更新 SHA-256
pnpm workflow:check      # 只读核验，不修改文件
node --test src/servers/providers/runpod/tests/h3-workflow-sync.test.js
```

平台专属实现、测试、运维说明和历史材料统一位于 `src/servers/providers/<id>/`。平台测试由 `npm test` 自动发现；测试和归档材料不进入发布包。Runpod 的当前操作见 [平台说明](src/servers/providers/runpod/README.md)。
