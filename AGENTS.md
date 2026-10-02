# AGENTS.md

本仓库是 DeepSeek Harness 外部插件 meiji（`meiji/`）。本文件是 Codex、Cursor、Claude 等 AI 工具的统一入口。

## 必读

- `.agents/meiji-dev.md`：模块职责、调用链、运行数据、生成任务指引、编码与数据规则及测试要求。
- `.agents/development.md`：两步开发流程与模板——调研与计划 → 实施与验证。

`.claude/`、`.cursor/` 下同名文件是指向 `.agents/` 的符号链接；修改规范只改 `.agents/`。

## 强制要求

凡修改 `meiji/` 下代码、配置、skill 或测试（`meiji/docs/`、`meiji/reports/` 除外），必须先读上述两份文档，按 `meiji-dev.md` 第 11 节判定档位，再按 `development.md` 执行：在回复开头写明档位，改代码前必须已有 `docs/plans/计划-*.md`，完成后 `cd meiji && npm test` 不得新增失败。

Claude Code 通过 `.claude/settings.json` 注册的 `.claude/guard.mjs` 强制执行：
- **UserPromptSubmit**：每条消息注入流程提醒。
- **PreToolUse**（Edit / Write / MultiEdit / NotebookEdit）：改 `meiji/` 下文件时，若 `docs/plans/` 中 24 小时内没有更新过的 `计划-*.md`，拒绝修改。

## 通用要求

- 使用中文沟通和撰写文档。
- 只改需求范围内的代码；不提交凭据。

## GitNexus 代码图谱

- 本项目使用已配置的 GitNexus MCP；工具不可用时使用本机 `gitnexus` CLI。索引保存在 `$HOME/.gitnexus/indexes`，不写入源码目录，不在全局 AGENTS.md 重复项目规则。
- 修改代码前先执行 `gitnexus status`；索引缺失或过期时先在仓库根目录执行下方索引命令。用户明确要求配置或刷新图谱时也执行。
- 调研时用 `gitnexus query "任务关键词" -r llm-dsh-plugins` 定位执行链，再用 `gitnexus context <符号名> -f <仓库相对文件路径> -r llm-dsh-plugins` 核对调用方与被调用方，并阅读实际源码。
- 修改目标确定后，用 `gitnexus impact <符号名> -f <仓库相对文件路径> -d upstream --include-tests -r llm-dsh-plugins` 评估调用方、受影响流程及测试；将结论写入本任务计划，按 `.agents/development.md` 执行。动态分派、插件注册等图谱未覆盖的关系需通过源码补查，不把无结果视为无影响。
- 修改后先执行 `gitnexus detect-changes --scope all -r llm-dsh-plugins` 对照计划检查实际影响，再完成项目要求的验证。文档修改不要求业务测试。

- 完成本项目代码修改及项目要求的验证后，在最终回复前更新 GitNexus 索引；同一任务集中更新一次，不在每次编辑后重复执行。
- 在本仓库根目录执行：`GITNEXUS_STORAGE_ROOT="$HOME/.gitnexus/indexes" gitnexus analyze --index-only`。
- 仅讨论、只读调研且索引有效时不更新。
- 更新失败时说明原因与索引可能过期，不宣称更新成功；不为修复索引问题修改无关业务代码。
