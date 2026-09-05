# dsh-elysium-tools

独立的 DeepSeek Harness Model API 工具插件。当前只注册：

- `model_generate_image`：调用 `http://127.0.0.1:8010/v1` 生成图片并等待任务完成。

源码按职责分层：

- `src/models/`：模型服务客户端与错误处理。
- `src/workflows/`：Harness 工具定义与调用流程。
- `src/index.js`：插件身份、导出和注册。

安装：

```sh
pnpm install
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```
