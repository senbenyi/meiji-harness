# dsh-elysium 开发约定

## 快速开发与调试

- 日常修改不要重复安装插件，也不要为每个小改动运行 `pnpm build` 或
  `pnpm release:local`。
- 开始修改前先检查监听器是否已运行；已运行时直接复用，不要重复启动。
- UI、CSS 或前端视图修改使用 `pnpm dev:ui`。它会监听源码并在保存后直接更新
  `registry/lib/client-registry.js`；构建完成后刷新浏览器即可验收，不需要重启 DSH。
- 服务端、路由或业务逻辑修改使用 `pnpm dev:server`。它会监听服务端源码、更新
  `registry/lib/index.js` 并自动重启 `dsh web`。
- UI 与服务端同时开发时，在两个终端分别保持 `pnpm dev:ui` 和
  `pnpm dev:server` 运行。不要在每次修改后停止监听器。
- 本地 DSH 默认地址为 `http://127.0.0.1:3080`。服务端修改后使用以下请求做轻量
  健康检查：

  ```sh
  curl -sS -X POST http://127.0.0.1:3080/elysium/api/project.list \
    -H 'content-type: application/json' --data '{}'
  ```

## 首次安装与完整交付

- 仅在 web profile 尚未链接本仓库 `registry/`、安装状态损坏，或准备完整交付时，
  执行 `pnpm release:local`。该命令会测试、完整构建、组装 registry、安装插件并
  重启 DSH，因此不用于日常小改动。
- 执行 `pnpm release:local` 前先用 `Ctrl-C` 停止两个开发监听器；完成后如需继续
  开发，再重新启动监听器。

## 验证原则

- 小改动优先运行与改动直接相关的测试、语法检查和 `git diff --check`，不要默认
  跑完整发布流程。
- UI 修改至少确认 `registry/lib/client-registry.js` 已更新；服务端修改至少确认
  `registry/lib/index.js` 已更新且 3080 健康检查成功。
- `lib/` 和 `registry/` 都是生成目录，不作为源码编辑入口；源码只在 `src/` 修改。
- 静态检查、测试、构建、安装、服务启动和 GPU E2E 是不同验证层级，交接时只报告
  实际完成的层级。
