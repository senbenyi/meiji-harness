# 合并图片下载与Base64步骤调研

## 结论
AC-1 — 已确认：registry.js image 函数现有四步计划。
AC-2 — 已确认：gateway.js generateGatewayImage 在两个 runStep 中分别下载与编码，可以合并同一回调。
AC-3 — 已确认：client/task-steps.js 独立显示两个名称，保存入口不需调整。

## 规格
- 目标：下载与转 Base64 合为一个任务步骤。
- 非目标：改动保存、鉴权、输入协议、历史任务记录、提示词或视频。
- AC-1：图片相关操作只计划调用 API、下载并转 Base64、保存候选三个步骤，执行与计划一致。
- AC-2：下载和转换由同一个 image_download 步骤记录状态；失败或停止后不保存；旧 b64_json 响应跳过该步骤。
- AC-3：当前任务和任务历史显示合并名称，保存与确认行为保持原有语义。

## 调用链
registry 图片计划 → gateway 请求、下载及转换 → image 保存 → task-steps 展示。

## 证据
| 来源 | 结论 |
|---|---|
| meiji/server/flow/operations/registry.js:19 | 四步计划 |
| meiji/server/generate/gateway.js:227 | 下载与转换分步 |
| meiji/client/task-steps.js:10 | 中文步骤名称 |

## 问题
| AC | 预期 | 当前 | 根因 |
|---|---|---|---|
| AC-1/2 | 三步 | 四步 | 上次拆分将转换另列一步 |

## 待用户决定
无。
