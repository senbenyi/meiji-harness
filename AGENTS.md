# AGENTS.md

本仓库是 DeepSeek Harness 外部插件 meiji（`meiji/`）。本文件是 Codex、Cursor、Claude 等 AI 工具的统一入口。

## 必读

- `.agents/architecture.md`：项目目录架构、模块职责、运行数据目录。
- `.agents/development.md`：开发规范——强制流程、编码与数据规则、测试、铁律，以及调研 / 计划 / 实施三阶段的步骤与模板。

`.claude/`、`.cursor/` 下同名文件是指向 `.agents/` 的符号链接；修改规范只改 `.agents/`。

## 强制要求

凡修改 `meiji/` 下代码、配置、skill 或测试（`meiji/docs/`、`meiji/reports/` 除外），必须先读上面两份文档，并严格按 `development.md` 第 1 节执行：在回复开头写明档位，改代码前必须已有 `docs/plans/计划-*.md`，完成后 `cd meiji && npm test` 不得新增失败。

Claude Code 通过 `.claude/settings.json` 注册的 `.claude/guard.mjs` 强制执行：
- **UserPromptSubmit**：每条消息注入流程提醒。
- **PreToolUse**（Edit / Write / MultiEdit / NotebookEdit）：改 `meiji/` 下文件时，若 `docs/plans/` 中 24 小时内没有更新过的 `计划-*.md`，拒绝修改。

## 通用要求

- 使用中文沟通和撰写文档。
- 只改需求范围内的代码；不提交凭据。
