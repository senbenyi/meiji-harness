# drama 模型设置

- 类型：新功能，完整流程。
- 目标：设置页加入主Agent GPT、文本、图片、视频配置，接通语言和模型持久化；主Agent与文本均使用用户指定meiji-server GPT。
- 非目标：不改制作节点、项目/任务字段，不复制公共setting校验与文件存储，不改meiji业务链。

## 验收标准与调研结论
| AC | 状态 → 结果 | 证据/缺口 |
|---|---|---|
| AC-1 | 打开设置 → 语言和主Agent/文本/图片/视频四项可配置 | 已有renderModelSettings未在drama调用，当前语言为固定值 |
| AC-2 | 选择/刷新/重启 → 保存恢复；失败回退 | 复用@agent-modules/setting SettingsModel与createSettingsStore |
| AC-3 | 主Agent GPT → Harness默认模型及项目会话使用meiji-server GPT | 用户确认主Agent和文本同服务；新服务地址及GPT模型ID正在确认 |
| AC-4 | 非法模型/未登录 → 拒绝并不覆盖文件 | 受鉴权HTTP及公共Model校验 |

## 调用链与影响
drama设置按钮→加载settings→renderSettings/renderModelSettings→POST settings→公共Model校验→公共createSettingsStore原子JSON→会话模型同步。设置连接不属于项目JSON。
MCP图谱对新drama符号返回UNKNOWN/not found；已源码核对HTTP入口、workbench、index及测试，settings-ui也被meiji引用，新增可选标题参数保留meiji原标签。
旧llm-server codex-gpt仅制作文本，不支持工具；用户确认改用meiji-server GPT。旧12711435未运行，旧43.15424711网关模型目录无GPT，已向用户询问正确连接，继续UI与保存独立工作。

## 改动
- drama/src/settings：业务模型选项与设置服务，复用公共setting。
- drama/src/http/project_routes.js：鉴权GET/POST设置，复用有上限JSON读取。
- drama/src/client/workbench.js/settings-ui.js：加载和保存，四模型选择与主Agent标题，失败反馈。
- drama/index.js/package.json：设置服务注入与公共包依赖；确认服务地址后同步主Agent宿主配置。
- tests：HTTP校验/持久化、UI展示/保存/失败回退、主Agent配置。

## 验证结果
- 基线drama28通过；新增后32通过；完整npm test805通过，0失败、0cancelled。
- Chrome显示语言及四类模型，文本修改后刷新恢复，最终恢复GPT默认；脚本错误0。
- 接入@agent-modules/http-client的modelClient.complete/generateImage/generateVideo；模型连接沿用meiji默认127.0.0.1:11435/v1，可由DRAMA_MODEL_BASE_URL指定。
- AC-3未完成：仅主Agent选择配置为GPT，尚未切换Harness实际会话模型。公共sendChat仅接受finish_reason=stop文本，modelClient.complete无tools参数；既有llm-server codex-gpt也不支持工具，不能把配置选择误报为主Agent工具会话已接通。未更改当前可用的宿主会话模型。
- 当前11435服务不可达，真实生成请求未验证。
