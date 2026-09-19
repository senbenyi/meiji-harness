# 剧情与Segment同步规划

类型：新功能。
单阶段：production-workflow.js 合并卡片并调整为六步（AC-1）；project-generation.js 新剧情请求带plan_segments标识（AC-1、AC-4）；production.js 合并校验和保存（AC-2、AC-3、AC-4）；production-rules.js 与 story-segments.md 加载联合规划规则；工具提示、README同步；UI与后端回归验证。
验证：专项测试、全量插件测试、构建打包后重启服务。

同步4份会话预设及本机对应规则，避免继续要求单独执行Segment阶段。git diff --check通过。
