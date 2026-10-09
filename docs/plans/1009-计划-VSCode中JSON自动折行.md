# VS Code 中 JSON 自动折行

- 类型：小改动（编辑器显示配置）
- 目标：在本仓库的 VS Code 中按窗口宽度显示 JSON 长字符串。
- 改动：新增 `.vscode/settings.json`，为 json、jsonc 设置 editor.wordWrap=on、editor.wrappingIndent=same。
- AC-1：打开 JSON 或 JSONC → 长行按编辑器窗口宽度折行显示。
- AC-2：提示词文件 → 内容和 JSON 格式不变，不引入三引号字符串。
- 验证：检查设置文件合法及配置值；核对提示词文件哈希；运行 git diff --check。实际 VS Code 显示待用户查看。
- 范围：仅编辑器元数据，无业务源码或符号变更，不执行业务测试和代码图谱更新。`.vscode/` 已被仓库忽略，设置仅本地生效。

## 验证结果
- 配置校验通过：JSON、JSONC 均为 editor.wordWrap=on，editor.wrappingIndent=same。
- 53 份提示词及方案 JSON 哈希一致，未修改内容或文件格式。
- 实际 VS Code 窗口显示尚未人工验收；工作区根目录打开本仓库时应用设置。
- 不执行业务测试：只改变编辑器显示配置。
