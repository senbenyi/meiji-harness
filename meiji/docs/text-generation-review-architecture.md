# 文本生成与自审执行架构

## 调用路径

面板或 function-call 工具 → 业务阶段 → runTextGeneration → askSkill / 模型 API → 既有 Model 保存层。

- `server/prompts/build-generation-prompts.js`：`buildGenerationPrompt`、`buildSelfReviewPrompt`，本地拼接任务上下文、最新基稿和意见，不调用模型。
- `server/workers/text-generation-worker.js`：唯一公开入口 `runTextGeneration`，绑定 skill、上下文与格式检查，控制最多两次生成和两次审核。内部调度函数不对外暴露。
- `server/prompts/continuity-review.js`：构建跨镜连续性审核资料，不调用 API。
- `server/data/self-checks.js`：沿用状态和并发回写，保存每轮审核到节点 `check.history`。

## 接入范围

剧集摘要、剧情包（大纲/人物/场景）、镜头表、单镜修改、每秒指令、文本分镜、图片提示词文本改写。单镜与批量复用同一路径。

独立审核、人工保存只审核；普通聊天不进入产物审核。图片、铅笔分镜、视频 API 不自动重复生成。

## 执行规则

首次生成 → 自审 PASS 则结束；明确内容 FAIL 则以刚生成的失败稿、失败原因和原人工意见定向修订一次，再次独立审核。再次失败保存并停止下游。接口错误、空结果、无效审核协议、格式/语法错误不进入自动内容修订。修订异常保留首次有效内容和失败原因。

生成与审核复用任务上下文和补充要求；语言由 askSkill 的系统指令注入。文本分镜审核还接收前镜最终提示词及素材映射。不得将密钥、锁和运行日志传入上下文。

## 验证

模拟 API 验证首次通过、修订后通过、连续失败上限、审核异常、修订异常、无效 JSON、批量停止和前镜连续性。运行 `node --test meiji/tests/*.test.js`。不以付费媒体任务作为验证方式。
