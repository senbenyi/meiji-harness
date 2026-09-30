# 合并图片下载与Base64步骤

- 类型：生成流程调整
- 目标：合并下载图片与转 Base64 为单步骤。
- 调研：docs/research/调研-合并图片下载与Base64步骤.md

## 待用户决定
无。

## 改动
1. meiji/server/flow/operations/registry.js:image — 删除独立 image_base64，保留三步 → AC-1。
2. meiji/server/generate/gateway.js:generateGatewayImage — 下载与转换放进同一个 image_download 回调 → AC-2。
3. meiji/client/task-steps.js:stepKindLabels — image_download 显示“下载图片并转 Base64”；保留旧 image_base64 的历史展示名称 → AC-3。
4. meiji/tests/gateway.test.js、image.test.js、character-image-edit.test.js — 更新三步成功、异常、停止与跳过断言 → AC-1/2。
5. meiji/docs/tasks-and-steps.md、.agents/architecture.md — 更新三步说明 → AC-3。

## 验收标准
- AC-1：图片相关操作只计划调用 API、下载并转 Base64、保存候选三个步骤，执行与计划一致。
- AC-2：下载和转换由同一个 image_download 步骤记录状态；失败或停止后不保存；旧 b64_json 响应跳过该步骤。
- AC-3：当前任务和任务历史显示合并名称，保存与确认行为保持原有语义。

## 验证结果
基线及改动后全量 npm test 均为 382 通过、0 失败、0 取消；相关测试 41 通过、0 失败、0 取消。git diff --check 通过。
