# 图片URL下载转Base64

- 类型：新功能
- 目标：统一处理图片 URL 响应，下载转 Base64 后交给现有保存流程。
- 调研：docs/research/调研-图片URL下载转Base64.md

## 待用户决定
无。

## 改动
### 阶段 1：响应处理与验证
1. meiji/server/generate/gateway.js:requestGatewayRaw、generateGatewayImage — 增加图片二进制日志及 URL 下载转 Base64；HTTP(S) 校验、同源 Bearer、同源禁止重定向、取消检查，保留 b64_json → AC-1、AC-2、AC-3、AC-4。
2. meiji/tests/gateway.test.js — 生成与编辑 URL 成功、旧 Base64、下载失败、空文件、无效 URL、外部鉴权与取消测试 → AC-1、AC-2、AC-3、AC-4。
3. meiji/tests/image.test.js、meiji/tests/session-log.test.js — 使用 URL 响应验证本地保存和日志脱敏 → AC-1、AC-3。
4. meiji/docs/gateway-api.md、meiji/docs/character-image-model.md — 更新响应约定 → AC-1、AC-4。

验证：cd meiji && node --test tests/gateway.test.js tests/image.test.js tests/session-log.test.js；cd meiji && npm test；git diff --check；更新 GitNexus 索引。

## 验收标准
- AC-1：文生图、参考图生图、人物修改收到 data[0].url 后下载并转 Base64，最终仍返回图片 Buffer，正常保存本地图片。
- AC-2：同源媒体下载携带生成请求 Bearer；外部 HTTP(S) 下载不传密钥；无效 URL、失败响应及空文件报错，不重复提交生成。
- AC-3：生成结束至下载期间及下载中的停止均有效；日志不记录 Base64 或密钥。
- AC-4：保留现有 b64_json 返回支持；不改变图片输入、提示词与视频流程。

## 验证结果
基线：372 通过、0 失败、0 取消。相关测试：37 通过、0 失败、0 取消。全量 npm test：376 通过、0 失败、0 取消。git diff --check 通过。真实网关联调未执行。
