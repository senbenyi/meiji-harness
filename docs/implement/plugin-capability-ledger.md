# 短剧插件能力账本

> 状态：已更新
> 基线：`dsh-short-video-studio` 1.8.1，2026-10-02
> 范围：记录当前仓库可调用入口及其迁移状态；不代表远程模型已经实机验证。

## 0. 结论

- 插件当前注册 51 个工具：17 个基础/兼容工具、28 个 Project Domain/执行工具和 6 个源文与剧本开发工具。
- 原画布 HTTP 路由仍保留外观与参数契约，但读写已经转到 `LegacyCanvasCommandAdapter` 和 Project Domain；旧 `project.json` 只作为首次导入源。
- 生成入口会先创建 `GenerationAttempt`，再提交 ComfyUI，并将结果保存为候选 Asset 和 ReviewTask。

## 1. 能力状态

| 能力面 | 入口 | 当前写入路径 | 状态 |
| --- | --- | --- | --- |
| Project | `studio_project_create/get/update_spec`、`/projects` | `ProjectService` | 已接入 |
| 故事与设定 | story、character、location、episode、shot 工具 | 领域命令 + revision CAS | 已接入 |
| 源文与剧本开发 | source import/read、内容分析、分集规划、正式剧本 Proposal | FileService → SourceDocument → Proposal → ReviewTask → StoryBible/Episode/Shot | 已接入；纯文本/TXT/Markdown |
| 生成 | 原生成工具与 HTTP route | Attempt → ComfyUI → Asset → ReviewTask | 已接入；远程实机待验收 |
| 审核 | `studio_review_queue/decide` | ReviewDecision；批准/拒绝直接推进 Asset 与 Shot | 已接入 |
| 时间线与交付 | timeline、deliverable 工具 | 仅接受 approved Asset | 已接入；FFmpeg 实机待验收 |
| 权利门 | rights 工具、生成/交付 policy | 成人项目要求成年确认和相应同意记录 | 已接入 |
| 兼容画布 | `/canvas*`、原 canvas tools | LegacyCanvasCommandAdapter → `replaceLegacyCanvas` 命令 | 已接入 |
| 二进制文件 | `FileService` | 路径约束、临时文件、hash、原子 rename | 已接入新媒体编排 |
| 诊断与审计 | diagnostics read model、hash-chain audit | 本地结构化状态 | 已接入 |

## 2. 状态口径

- `已接入`：当前代码路径和离线测试均有证据。
- `远程实机待验收`：需要活动 Qwen/ComfyUI、模型文件、自定义节点或真实媒体产物，不能由离线测试替代。
- Harness 官方包解析结果通过 `dsh --profile web --dump-config`、本机安装树和插件加载日志复查；本次基线为 144/144 可解析、0 unresolved。
