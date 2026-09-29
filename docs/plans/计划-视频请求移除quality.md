# 视频请求移除 quality

- 类型：小改动（明确报错的单处修复）
- 目标：修复 POST /v1/videos 因携带不支持的 quality 字段被拒绝。
- 调研：无；用户实际响应为 `json: unknown field "quality"`，`submitGatewayVideo` 固定发送 `quality: 'medium'`。

## 待用户决定
无。

## 改动
1. `meiji/server/generate/gateway.js:submitGatewayVideo` — 移除固定 quality 字段，沿用网关默认值；不改其他请求字段 → AC-1。
2. `meiji/tests/production.test.js:gateway video submits one shot and downloads the finished mp4` — 更新纯文字、首帧和多图模式的完整请求体断言，确保均不含 quality → AC-1、AC-2。

## 验收标准
- AC-1：所有视频模式发送的 JSON 均不含 quality。
- AC-2：模型、提示词、时长、对应参考图字段保持正确，任务 ID 与下载链路测试通过。

## 验证
- 改动前后 `cd meiji && npm test`；改动后不得新增失败或取消。
- 定向运行 production 测试及 `git diff --check`。
- 不调用真实收费视频接口；实际网关生成结果需重启后重试验证。

## 验证结果
- 基线与改动后均为 350 项：349 通过、1 失败、0 取消，无新增失败。
- 原有失败：`a character still prompt keeps the face and figure and drops clothing`，人物技能当前正文与测试期待的措辞不一致；属于用户已有修改，本次不调整。
- 定向 production 测试：4 通过、0 失败、0 取消；纯文字、首帧、多图请求均通过完整 JSON 断言。
- `git diff --check` 通过。
- 未调用真实网关生成视频，未重启运行服务。
