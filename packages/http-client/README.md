# HTTP 与模型调用

公共请求层和模型协议客户端。其他 Agent 可直接调用文本、图片和视频接口，无需任何业务项目、任务或步骤对象。

```js
import { modelClient } from '@agent-modules/http-client';

const connection = { baseUrl: 'http://127.0.0.1:11435/v1' };
const png = await modelClient.generateImage({
  ...connection, model: 'gpt-image', prompt: '产品展示海报', aspectRatio: '1:1',
});
const video = await modelClient.generateVideo({
  ...connection, model: 'MiniMax-H3', prompt: '产品缓慢旋转', duration: 5,
  mode: 'text', aspectRatio: '16:9',
});
const mp4 = await modelClient.downloadVideo({ url: video.url });
```

以上示例会请求实际服务。零费用的本地模拟示例在仓库根执行 `npm run example`。

## 模型接口

`modelClient` 对接现有 llm-server HTTP 协议，服务端负责实际供应商连接与凭据；默认本机地址由调用方传入，默认请求密钥为 `ollama`，启用服务鉴权时可传 `apiKey`。

| 方法 | 输入 | 返回 |
|---|---|---|
| `complete` | `baseUrl, model, messages`；模型名由调用方传入 | 最终文本 |
| `generateImage` | `baseUrl, model, prompt, aspectRatio` | 图片 Buffer |
| `generateVideo` | `baseUrl, model, prompt, duration, mode, aspectRatio` 及本模式素材 | `{ taskId, url }` |
| `downloadVideo` | `url` | 视频 Buffer |
| `gpu` | `baseUrl` | 服务端 GPU 状态 |

- 图片：`gpt-image` 调用 `/images/generations`，`references: [{ mime, bytes }]` 最多 5 张，固定 `size/quality=auto`，画幅写入请求提示词；`krea2 turbo V2.5` 调用 `/images/comfy`，支持 `quality`，不支持参考图。协议参数构造函数通过 `@agent-modules/http-client/model-parameters` 导出，可用于请求预览。
- 视频：固定 `MiniMax-H3`、`resolution=768P`、4–15 整数秒。`mode=text` 为文生；`mode=first_frame` 提供 `inputReference`，可选 `lastFrame`，比例为 adaptive；`mode=reference` 提供 1–9 张 `referenceImages`。素材支持协议允许的 image data URL、https 或 mm_file 地址。非法模式组合在发送前拒绝。
- `baseUrl` 不允许用户名、密码、查询串或锚点。下载不携带模型服务 Authorization，不在记录里保存签名查询串；媒体字节由调用方自行校验、保存。

## 异步受理与恢复

给 `complete/generateImage/generateVideo` 传稳定的 `requestId`，即发送 `X-Task-ID`、`Idempotency-Key`、`Prefer: respond-async`。202/409 后查询同一 `/tasks/{id}`，成功后读取 `/result`。只有查询会在网络未知/5xx 时继续等待，默认每 5 秒；不重复提交生成。服务端记录缺失、结果过期或终态失败会明确抛错。

恢复时传 `requestId`、`recovering: true`、`resumeFrom`（原生成请求的完整地址），以及原模型参数。公共包不接收历史任务/步骤快照，历史记录由调用方自行保存。调用方须在发送前通过异步 `record` 回调可靠保存请求标识与地址；回调失败时不会发送请求。不要从脱敏日志重建图片/视频正文。

`signal` 停止本地等待；`shouldStop(reason)` 返回 true 时额外向服务端 `/stop` 发出尽力停止请求。默认 false，由宿主明确区分用户取消与进程退出。远端是否真正停止取决于服务端和供应商能力。

## 传输与记录

```js
import { requestData, sendChat, withRequestTrace } from '@agent-modules/http-client';

const result = await requestData({
  url: 'https://service.example/endpoint', method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: { input: '资料' },
}, { signal, record: async (row, options) => saveRequestRecord(row, options) });
```

`requestData(request, options)` 支持 JSON、FormData 和二进制响应（`responseType: 'bytes'`），返回 `{ ok, response, data, durationMs }`。`body` 默认按 JSON 发送；FormData 原样发送，记录内容由 `logBody` 提供。HTTP 错误作为结果返回，网络/读取错误抛出；`validateResponse`、`validateData` 可在记录结算前做协议校验。默认总时限及响应头/体等待时限为 60 分钟，dispatcher 在调用时读取全局代理；可传 `timeoutMs`、`dispatcher` 或 `fetchImpl`。

`sendChat` 可直接调用任意 OpenAI 兼容的非流式文本接口，连接和完整请求体由调用方提供。默认仅普通同步请求的 502/503/504 按 1秒、3秒重试；不重试 400、网络异常或不完整输出。异步模型请求不重新提交。`retryDelays` 可覆盖等待策略。

记录优先使用显式 `record(row, options)`，否则使用 `withRequestTrace(record, run)` 的并发隔离上下文。发送前、响应后各调用一次，同一次请求的 row 对象保持身份；持久化应在回调内复制内容。`options.drop=true` 表示删除不需要保留的中间轮询。`keepRecord(result)` 可决定轮询记录是否保留。日志脱敏接口为 `publicHeaders/publicData/redactJson`：隐藏 Authorization、API key 和 Base64 媒体；原始响应仍完整返回给调用方。

底层 `requestRemoteTask/remoteTaskHeaders` 位于 `@agent-modules/http-client/remote-task`，可在不使用模型客户端时独立接入相同异步服务协议。
