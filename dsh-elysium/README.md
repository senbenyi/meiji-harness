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
├── servers/                  # 按 registry/runtime/transport/providers 分包
│   ├── registry/             # 配置与目标解析
│   ├── runtime/              # 平台加载、调度与任务归属
│   ├── transport/            # 连接建立与复用
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

## 服务器模块职责

```text
servers/
├── registry/              # 配置校验、持久化与目标解析
│   ├── schema.js
│   ├── store.js
│   └── resolve.js
├── runtime/               # 平台加载、调度与任务归属
│   ├── index.js           # 统一平台调用入口
│   ├── loader.js          # 模块发现与契约校验
│   ├── check.js           # 服务检查及默认目标切换
│   ├── backend.js         # 任务后端快照
│   └── standard-adapter.js # 公共协议组合
├── transport/             # 连接建立与复用
│   └── connection.js
└── providers/             # 各平台完整实现及其模板
    ├── runpod/
    ├── autodl/
    ├── featurize/
    ├── vast/
    └── local/
```

## 短剧快速预览

调用 `workflow_generate_video` 时传入所属项目的 `project_id` 并增加 `profile: "preview"`，支持 `t2va` 或带 `first_frame` 服务器图片 URL 的 `i2va`。当前预览为 H3、384×512、73 帧、24fps、8 步，约 3.04 秒，保留联合音频并跳过 RIFE。省略 profile 或使用 `standard` 恢复原工作流。

配置位于 `src/servers/providers/runpod/workflows/minimax-h3/profiles/preview.json`；具体验收、三镜头样片、恢复方式及限制见 [快速预览说明](../docs/implement/实施-AI短剧快速预览.md)。

## 构建

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
node harness/scripts/install.mjs
```

## 工作流同步

```sh
pnpm workflow:sync       # 从当前选中平台的 ComfyUI 同步 UI 图，编译 API 图并更新 SHA-256
pnpm workflow:check      # 只读核验，不修改文件
node --test src/servers/providers/runpod/tests/h3-workflow-sync.test.js
```