# 删除旧 Elysium 媒体协议实施记录

## 已修改文件
- 删除 `projects/meiji/server/http/elysium/legacy/{gateway,media,video-params}.js`、`server/http/elysium/video-params.js`、`server/gateway/model-gateway.js`。
- `projects/meiji/server/http/ai-routes.js`：图片、视频只走当前公共客户端；视频严格使用返回的 taskId/url，移除旧 id 返回及 content URL 兜底。
- `projects/meiji/server/runtime/app-runtime.js`：删除旧视频地址识别、轮询分支，下载直接使用返回 URL；测试注入使用 downloadVideo。
- `packages/http-client/src/llm-server/params.js`、`projects/meiji/server/http/llm-server/client.js`：移除旧视频地址拼接、识别函数及重导出。
- `projects/meiji/server/media/decode-image-data.js`：保留现有 dataUrl 功能，两个媒体 handler 改从此处导入。
- `projects/meiji/tests/{gateway,film-pipeline,media-images,runtime}.test.js`、`tests/fixtures/ai.js`：视频使用当前 video/downloadVideo 注入及 taskId/url 返回；完整链校验下载地址与生成返回一致。
- 根及 meiji README：更新已删除旧协议的说明及参数实现位置。
- 未修改既有 `packages/task/manager/index.js` 和 `packages/task/tests/manager.test.js` 的并行变更。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 当前客户端生成；缺少 taskId/url 明确拒绝；下载直接使用返回地址，无旧协议调用回退 |
| AC-2 | 通过 | 三种视频方式真实本地模拟 HTTP、图片流程、完整制作链、FFmpeg 尾帧、下载错误、取消与旧结果保留测试通过 |
| AC-3 | 通过 | 旧媒体源文件与重导出已删除；server/tests/公共 HTTP 源码中旧符号及导入无残留；dataUrl 编解码及媒体编排通过 |

## 测试
- 改前 meiji：674 通过、0 失败、0 cancelled；HTTP 包：21 通过、0 失败、0 cancelled。
- 专项 gateway/media-images/runtime/film-pipeline/video-service/multimodal-continuity：82 通过、0 失败、0 cancelled。
- 根 npm test：758 通过、0 失败、0 cancelled；其中 meiji 671，HTTP 21，composer 25，setting 8，task 27，工程 6。task 数量包含原有并行修改。
- 删除 4 项仅针对退役协议的测试：旧图片 JSON/multipart、旧视频提交轮询、旧三方式视频载荷、旧直连素材边界；当前图片/视频协议、参考图及异步处理由公共 HTTP tests/models.test.js、meiji gateway/video-service/media-images/film-pipeline 继续覆盖。原三方式测试中的提示词保留检查已合并到当前 MiniMax 的实际 HTTP 测试。
- 新增 1 项：返回缺少 taskId 或 url 时拒绝，不拼接旧下载地址；原图片解码测试同时验证迁移后的 dataUrl 往返。
- npm run verify:install：四个 tarball 在隔离目录离线安装并运行成功；文本、图片、视频生成下载及独立 task 链通过。
- git diff --check 通过。专项、全量、安装日志分别为 `/tmp/delete-legacy-focused.log`、`/tmp/delete-legacy-full.log`、`/tmp/delete-legacy-install.log`。
- GitNexus 预检 dataUrl/videoContentAddress/isGatewayContentAddress 为 HIGH，调用方已同步；旧生成/提交/轮询为 UNKNOWN，已以源码检索补查。detect_changes 完整结果包含 21 个跟踪文件、89 个符号及 29 条流程，critical 来自整段协议删除及原有并行 task 修改，未出现 partial/truncated 标志；代码图谱收尾更新日志为 `/tmp/delete-legacy-final-index.log`。
- 未调用真实模型。

## 人工待办
无。历史记录中的旧远端任务不再提供 Elysium 轮询恢复；已保存的本地文件不受此次源代码删除影响。
