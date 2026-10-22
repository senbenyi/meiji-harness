# 复制按钮 Toast 反馈

- 类型：交互修复，完整流程（公共组件及多个节点/会话入口）。
- 目标：复制按钮始终保留原文案、始终可重复点击，成功/失败均以toast反馈。
- 非目标：不改变复制内容、业务操作、存储、模型或其他按钮的加载状态。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 调研 | 依据 |
|---|---|---|---|
| AC-1 | 点击各入口复制 → 原文案保留、按钮不禁用，每次都执行复制 | 已确认需修复 | task/http/rules公共UI，Drama task-operation和scriptNodeCard均修改文案/disabled |
| AC-2 | 复制成功/失败 → 短暂toast提示，无固定页面提示，失败可直接重试 | 已确认 | task已有onNotify；http/rules需增加通知透传，Drama各入口调用showToast |
| AC-3 | 任务内HTTP、全局HTTP、节点规则、会话输入输出与工作稿 → 所有复制位置覆盖且内容不变 | 待验证 | 复用原read/copy逻辑，仅调整反馈 |

## 调用链与影响
- 公共task → renderHttpDetails；Drama workbench/project-overview → task/http/rules；task-messages → task-operation；scriptNodeCard工作稿复制。
- GitNexus task/http/rules/createTaskOperation/createProjectView：CRITICAL，已向用户提示多入口回归范围；mount UNKNOWN由panel动态入口及源码核对；scriptNodeCard符号UNKNOWN，使用文件impact补查并核对注册表/概览/测试。
- 基线：Drama上轮167通过；本轮记录公共task/http/prompt-composer基线。

## 待用户决定
无。

## 改动
1. packages/task/ui/index.js：复制仅通知，不改文案/disabled；向嵌套HTTP透传onNotify。
2. packages/http-client/ui/index.js、prompt-composer/src/ui/rules-panel.js：新增可选onNotify通知，移除复制按钮状态改写和固定复制提示。
3. Drama workbench/project-overview：HTTP和规则统一接showToast；会话/剧本卡片复制成功失败直接toast，允许连续点击。
4. 同步既有测试断言；验证异步未完成时连续点击也不被拦截、两次复制与通知均发生；不为简单toast增加独立测试目录。

## 验证
公共三包测试、Drama全量；临时JSDOM真实toast及重复点击烟测；verify:copy、diff检查、detect_changes和最终图谱更新。

## 验证结果
- AC-1：五类复制实现均不再修改按钮文案或disabled；task异步复制未完成时连续点击两次，两次调用/两次通知均验证。
- AC-2：成功/失败通知用例通过；真实toast接线临时烟测验证HTTP和会话提示、重复复制、2.5秒自动消失；页面不保留固定复制提示。
- AC-3：task/http/rules、剧本原文和会话原有测试通过；入口递归资源测试也覆盖新@agent-modules/ui导入映射。
- 公共包基线与改后均：task42、http53、prompt25通过；Drama基线与改后均167通过，0失败、0 cancelled。
- 完整npm test：各批53+25+11+42+671+7+167，共976通过、0失败、0 cancelled。
- verify:copy -- drama通过；git diff --check通过。没有改包依赖或服务端路由，无需重启，刷新加载新资源。
- detect_changes累计已跟踪差异179符号/95流程/45文件，含前序未提交变化；无partial/truncated，保留已有工作区变更。最终force索引成功：11301节点、31718边、483流程。
