# 图片URL下载转Base64调研

## 结论
AC-1 — 已确认问题：gateway.js 的 generateGatewayImage 仅解析 b64_json，URL 响应会报未返回图片。
AC-2 — 已确认：下游接入接口文档 (3).md 296–305 行要求媒体下载使用创建时的 Bearer。
AC-3 — 已确认：请求已有信号、超时与脱敏日志，可复用；下载需补充前后取消检查。
AC-4 — 已确认：image.js 接收 Buffer 并保存；视频已有独立 binary 下载。

## 规格
- 目标：图片接口响应 URL 自动下载转 Base64，继续交给本地保存流程。
- 非目标：修改输入协议、提示词模型、视频流程或数据存储结构。
- 验收标准：
- AC-1：文生图、参考图生图、人物修改收到 data[0].url 后下载并转 Base64，最终仍返回图片 Buffer，正常保存本地图片。
- AC-2：同源媒体下载携带生成请求 Bearer；外部 HTTP(S) 下载不传密钥；无效 URL、失败响应及空文件报错，不重复提交生成。
- AC-3：生成结束至下载期间及下载中的停止均有效；日志不记录 Base64 或密钥。
- AC-4：保留现有 b64_json 返回支持；不改变图片输入、提示词与视频流程。

## 调用链
图片操作 → submitAssetImage / 图片修改 → generateGatewayImage → POST images/generations 或 images/edits → 解析响应 → Buffer → 本地保存。
失败由 markApiFailure 标记；不会在下载失败后重新生成。

## 证据
| 来源 | 支持结论 |
|---|---|
| meiji/server/generate/gateway.js:165 | 所有图片请求共用响应解析；当前只读 b64_json |
| meiji/tests/image.test.js:205 | 调用方需要 Buffer 并保存本地文件 |
| 下游接入接口文档 (3).md:296 | URL 媒体响应及 Bearer 下载要求 |

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1 | URL 可下载保存 | 报未返回图片 | 缺少 URL 下载分支 |

## 待用户决定
无。
