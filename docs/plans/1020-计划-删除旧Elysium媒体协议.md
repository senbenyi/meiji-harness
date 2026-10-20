# 删除旧 Elysium 媒体协议

- 类型：完整流程，删除旧协议及其跨文件调用。
- 目标：删除旧 Elysium 生图、媒体下载、视频提交轮询；当前图片/视频继续使用公共 HTTP 包。
- 非目标：不清理 Elysium 文本协议，不改业务数据字段，不接入其他公共 UI，不处理 task 包已有修改。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 判定及依据 |
|---|---|---|
| AC-1 | 项目执行媒体请求 → 只调用现有公共模型客户端，不回退旧协议 | 已确认：ai-routes.js 与 app-runtime.js 仍有旧分支，待删除 |
| AC-2 | 三种视频方式、图片参考素材、下载与尾帧 → 保持当前工作流 | 未验收：以 gateway、media-images、runtime、film-pipeline 和公共包测试验证 |
| AC-3 | 旧协议源文件及导入 → 全部移除；dataUrl 仍可供现有流程使用 | 已确认：dataUrl 有两个 handler 使用，需移至媒体工具 |

## 调用链与证据
- createAiRoutes → generateGatewayImage / submitGatewayVideo；app-runtime.downloadVideo → retrieveGatewayVideo。
- media-handler / video-prompt-handler → model-gateway.dataUrl。
- legacy/gateway.js、media.js、video-params.js 实现旧协议，外层 model-gateway.js 和 elysium/video-params.js 仅重导出。
- 公共 http-client 的 videoContentAddress / isGatewayContentAddress 仅为上述旧流程提供地址拼接与识别，无其他源码消费者。
- GitNexus 已 force 重建。createAiRoutes/createAppRuntime/两个 handler 风险 LOW；dataUrl 为 HIGH，涉及媒体与程序编排，迁移后跑完整测试。旧生成/提交/轮询符号为 UNKNOWN，已以全文导入、动态回退和测试引用补查，不能认定无调用。

## 待用户决定
无；用户已明确要求删除旧媒体逻辑。

## 改动
1. 删除 legacy 三个源文件、两个重导出入口；dataUrl 移到 server/media/decode-image-data.js 并同步两个 handler。对应 AC-3。
2. ai-routes 只使用公共图片/视频生成；runtime 只下载返回 URL，删除 meiji 及公共包的旧视频地址辅助。对应 AC-1。
3. 删除仅验证已退役协议的测试，视频注入 fixtures 改为当前 taskId/url 返回；保留三种方式的实际 HTTP 测试、错误校验、下载、完整制作链。对应 AC-2。

## 验证
- 基线：meiji 674 通过、0 失败、0 cancelled。
- 改后先跑受影响测试，再跑根 npm test（涉及公共 HTTP 辅助导出）；检查旧符号/导入、git diff --check、detect_changes，最后刷新索引。
- 不调用真实付费模型。

## 验证结果
- AC-1～AC-3 通过，实际记录见对应实施文档。
- 专项 82 通过；根 npm test 共 758 通过、0 失败、0 cancelled（meiji 671、HTTP 21、composer 25、setting 8、task 27、工程 6）。
- meiji 基线 674 → 671：删除 4 项已退役协议测试，新增 1 项缺少视频 ID/URL 时拒绝测试。
- verify:install 四个 tarball 离线独立安装和运行通过；旧符号与导入检索无残留；git diff --check 通过。
- detect_changes 完整返回 21 个跟踪文件、89 个符号、29 条流程，风险 critical，主要为整段旧协议删除；包含另一路原有 task 包修改，已与本次文件范围区分。未出现 partial/truncated 标志。HIGH 辅助函数风险已通过完整媒体链测试验证。
