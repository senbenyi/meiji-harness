# 复制按钮 Toast 反馈实施记录

## 已修改文件
- packages/task/ui/index.js：复制保留文案、不禁用，通知回调透传内嵌HTTP。
- packages/http-client/ui/index.js：HTTP详情/历史onNotify透传，复制仅通知，不改按钮或添加固定提示。
- packages/prompt-composer/src/ui/rules-panel.js：规则复制onNotify，不禁用或改写按钮文案。
- projects/drama/src/client/workbench.js、project-overview.js：全局/节点HTTP和规则统一接showToast。
- projects/drama/src/client/ui/task-operation.js：独立复制控件支持连续点击，成功失败toast；其他读取按钮保留原加载交互。
- projects/drama/src/client/task-messages.js：透传可选onNotify供独立会话组件接线与验证。
- projects/drama/src/node_box/script_revision/ui/panel/index.js：工作稿复制保留原文案，以toast反馈。
- 对应公共包和Drama既有测试更新断言，验证重复点击与通知；开发方向同步契约。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 各按钮原文案保留、disabled为false；异步复制未结束时双击执行两次 |
| AC-2 | 通过 | 成功/失败通知、无固定提示；HTTP及会话接真实toast烟测 |
| AC-3 | 通过 | 任务/HTTP/规则、原文、会话输入输出测试及浏览器资源依赖加载 |

## 测试
- 基线：公共task42/http53/prompt25、Drama167，全部通过，无失败或取消。
- 改后相关测试数相同并全部通过。
- 完整npm test共976通过（53/25/11/42/671/7/167各批），0失败、0 cancelled。
- verify:copy -- drama通过；临时JSDOM真实toast接线烟测通过；git diff --check通过。
- 影响检查公共组件CRITICAL已提示；累计detect_changes无partial/truncated，含前序尚未提交改动。图谱缺少的动态入口由源码、真实模块遍历与交互测试补查，未将无流程视为无依赖。
- 最终force图谱更新成功：11301节点、31718边、483流程。
- 不改依赖、服务端路由和业务数据，无真实模型调用，无重启。

## 人工待办
无。刷新网页加载新浏览器资源即可。
