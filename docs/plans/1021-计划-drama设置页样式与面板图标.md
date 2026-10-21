# drama设置页样式与面板图标

- 类型：完整流程，多文件UI优化与返回导航修复。
- 目标：设置页固定黑底白字，返回按钮有清楚的交互反馈并回到来源页面，右面板使用Harness同款侧栏图标。
- 非目标：不改模型设置接口、视频接口或Harness源码，不改项目数据。

## 验收标准与证据
| AC | 输入/状态 → 可观测结果 | 依据 |
|---|---|---|
| AC-1 | 宿主明/暗主题 → 设置页文字白色、页面/分组/下拉框黑色 | 用户截图；ShadowRoot未设置color，select无专属背景；基线drama34通过 |
| AC-2 | 从首页/项目/片库进入设置 → 返回来源页面，按钮有hover/focus/active反馈 | settings-ui缺少back类，workbench回调固定项目/首页 |
| AC-3 | 面板展开/收起 → 顶栏为右侧分隔线SVG，保持aria状态和恢复宽度 | 宿主IconPanelLeftOutlineRegular镜像，来自deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx |
| AC-4 | 修改共享设置DOM → 原保存回调及meiji调用方继续可用 | settings-ui被drama和meiji共同调用；只加样式类/按钮语义，不改回调参数 |

## 调用链与影响
panel.js → createShell + workbench.mount → renderSettings/renderModelSettings。createShell仅drama使用；renderSettings由meiji的workbench/task-panel调用。GitNexus刷新完成后impact三个目标均CRITICAL，context缺少符号UID且出现媒体/迁移函数错误关系；不能把图谱结果当作无影响。源码查证真实共享边界，保留接口并验证drama与meiji相关UI。

## 改动与验证
1. settings-ui.js：返回按钮补back类及可访问性语义；workbench.js：记录设置来源，返回片库时保留片库。
2. project-ui.css：作用域内固定黑/白、表单边框、返回按钮hover/focus/active与布局；panel-shell.css固定基础前景色并设置SVG尺寸、移除箭头旋转。
3. panel-shell.js：同宿主侧栏SVG图形，右侧分隔线，展开/折叠保持同一图标及aria。
4. 测试既有按钮导航与开关恢复；浏览器验证明/暗主题实际样式、hover/focus、下拉框及收起/展开，检查截图。

## 待用户决定
无。

## 验证结果
- AC-1～AC-4通过。drama基线与修改后均34通过、0失败、0取消；meiji相关ui-navigation/ui-lifecycle/api-session共42通过、0失败、0取消。
- 使用本机Google Chrome的Playwright检查真实页面：light/dark下页面、分组、下拉框、option与返回按钮为黑底白字；hover白边、键盘focus白色轮廓、侧栏图标、折叠48px/恢复宽度和返回片库均通过，无浏览器运行错误。
- 实际截图/tmp/drama-settings-20261021.png已查看；浏览器日志/tmp/drama-settings-ui-browser.log。
- git diff --check通过。初次detect_changes仍错误关联大量无关流程并给出CRITICAL，图谱未作为通过依据；真实调用方用源码和两项目UI测试核对。最终索引刷新与复查结果见实施记录。

用户追加布局调整：返回按钮仅保留箭头，与设置标题放在同一行，保留aria-label和提示标题。新增settings-heading容器，不使用会继承宿主header样式的标签。drama34项通过，真实Chrome中箭头/标题中心对齐（偏差小于1px）且返回功能通过。
