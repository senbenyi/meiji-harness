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

服务端默认目录 `/workspace/runpod-slim/ComfyUI`、端口8188、虚拟环境 `.venv-cu130`；配置位于 `config.js`。旧 `runpod/scripts/comfyui.mjs` 为兼容入口。管理操作不会被安装/生成/检查自动触发；Harness 仍只在本机运行。

这不是云实例租赁 API。当前仓库没有实现的购买实例、自动安装镜像和下载模型不在本模块中伪造。

## 其他平台参考方法

建立独立 `providers/<id>/index.js`，导出同版本契约，复制并修改本目录的组合模式和平台配置，不能导入本目录。兼容 ComfyUI/H3、Qwen 的服务可直接复用 `../../standard-adapter.js`；镜像路径、进程管理差异写在自己的模块中。公共客户端、模型模板、项目和批次留在公共层。

平台发现自动识别新的完整入口，前端不需要增加枚举。空目录不可调用，依赖损坏或版本不兼容明确报错。删除本目录后，已切换到其他已实现平台的业务仍可运行；原 Runpod 任务不会迁移，而是显示平台不可用。测试 AutoDL 实现只存在临时副本中，正式 AutoDL 尚未接入。
