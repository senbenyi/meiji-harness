# Runpod 平台适配器

职责：提供仓库已有 Runpod 服务的完整接入实现和其他平台的参考结构。入口为 `index.js`，接口版本为 1。

## 完整调用流程

1. 在服务器设置登记已部署实例（参考 `server.example.json`）。连接支持 HTTP 或本机 SSH，凭据只引用环境变量。
2. 公共 runtime 按记录 provider 加载本模块；`validateRunpod` 校验实例/部署身份和现有 H3/Qwen 服务能力。
3. `connect` 建立/复用本机专属 SSH 控制连接，或使用明确的 HTTP URL。
4. `check` 核对服务、节点及模型，检查通过才允许切换默认目标。
5. 新任务保存 provider 和后端快照；`buildGraph` 构建 H3 图；`createClient` 提供 submit/request/wait/viewUrl，公共执行器负责提交日志、重试和恢复。队列取消只移除目标排队项。
6. 批次、参考帧、原子工具、历史媒体继续经该快照调用本模块；输出使用服务器 URL，不搬运媒体。
7. `llmSettings` 返回兼容 Qwen 路由，下次启动由 Harness 应用；模块不热改聊天模型。
8. `workflowSource` 返回此实例的同步来源；`scripts/workflow-sync.mjs` 编译和检查五种公共 H3 工作流。
9. `manage` 提供模型服务器上的 ComfyUI check/start/stop/restart，见下方命令。

## 显式运维

在已配置当前镜像的模型服务器上执行仓库中的统一 CLI：

```sh
node dsh-elysium/scripts/server-service.mjs runpod check
node dsh-elysium/scripts/server-service.mjs runpod start
node dsh-elysium/scripts/server-service.mjs runpod stop
node dsh-elysium/scripts/server-service.mjs runpod restart
```

服务端默认目录 `/workspace/runpod-slim/ComfyUI`、端口8188、虚拟环境 `.venv-cu130`；配置位于 `config.js`。旧根目录 `runpod/` 已撤销，统一使用上述核心路由 CLI。管理操作不会被安装/生成/检查自动触发；Harness 仍只在本机运行。

这不是云实例租赁 API。当前仓库没有实现的购买实例、自动安装镜像和下载模型不在本模块中伪造。

## 其他平台参考方法

建立独立 `providers/<id>/index.js`，导出同版本契约，复制并修改本目录的组合模式和平台配置，不能导入本目录。兼容 ComfyUI、Qwen 的服务可复用 `../../standard-adapter.js`，并显式提供自己的 buildGraph；镜像路径、进程管理差异写在自己的模块中。公共客户端、项目和批次留在公共层；每个平台管理自己的模板、档位和图构建。

平台发现自动识别新的完整入口，前端不需要增加枚举。空目录不可调用，依赖损坏或版本不兼容明确报错。删除本目录后，已切换到其他已实现平台的业务仍可运行；原 Runpod 任务不会迁移，而是显示平台不可用。测试 AutoDL 实现只存在临时副本中，正式 AutoDL 尚未接入。


## 集中管理边界

```text
runpod/
├── index.js                  # 平台契约入口
├── config.js                 # 部署与能力配置
├── service.mjs               # 当前镜像服务生命周期
├── server.example.json       # 登记样例
├── workflows/               # 原有模板、档位、图构建和同步编译器
│   ├── minimax-h3/           # graph.js、profile.js、profiles/、templates/
│   └── sync.mjs              # 完整保留 UI 元数据的同步实现
├── tests/                    # 平台契约、生命周期及 H3 模板测试
├── resources/workflow-previews.json # 原实例 UI 预览缓存归档
├── legacy/                   # 旧运维说明及冻结制作脚本
└── README.md                 # 当前使用说明
```

外部只通过平台配置和核心路由调用本模块。原有五份 H3 模板及三份档位配置已按 Git 原始字节恢复，完整包含 videopreview、fullpath 等已有字段；图构建和同步编译器一并归入 workflows。公共 ComfyUI 仅提供协议，不持有这些模板。工作流同步也完整保留源 UI 元数据。

旧 manual 手工连接通过核心路由明确使用 Runpod 原模板；移除 Runpod 后该兼容模式不能继续生成。其他已实现平台需提供自己的 buildGraph 和可选 syncWorkflows，不得导入 Runpod。
`npm test` 动态发现各平台的 tests；删除本目录不会留下固定测试导入。tests、legacy、resources 不进入构建包或任务执行代码指纹。

旧制作脚本位于 `legacy/third-cup-preview.mjs`，已不匹配当前项目级 CLI，原始脚本按 Git 内容保留，仅供历史审计，不是当前可执行入口。当前制作使用 `dsh-elysium/scripts/production-runner.mjs`。旧运维材料见 [历史说明](legacy/operations.md)，其中路径与命令仅作为历史记录，当前操作以本 README 为准。
