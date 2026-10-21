# drama设置页样式与面板图标实施记录

## 已修改文件
- `projects/drama/src/client/settings-ui.js`：返回按钮补back样式类与返回上一页语义，不改变既有保存/返回回调接口。
- `projects/drama/src/client/workbench.js`：记录设置来源页，从片库进入设置后返回片库；重复点击设置不覆盖来源。
- `projects/drama/src/client/project-ui.css`：设置页文字固定白色、背景/分组/下拉框固定黑色，返回按钮hover/focus/active反馈及减少动效支持。
- `projects/drama/src/client/panel-shell.{js,css}`：基础黑底白字，使用Harness IconPanelLeftOutlineRegular同款SVG并镜像到右侧分隔线；展开/收起保留同一图形，状态由title/aria表达。
- `projects/drama/tests/{panel-shell,create-project-http}.test.js`：覆盖新返回导航及面板图标/展开状态/宽度恢复。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | Chrome明/暗模式实际计算样式均为白色文字、黑色背景；截图复核 |
| AC-2 | 通过 | 首页返回、片库来源返回；真实hover白边、键盘焦点轮廓通过 |
| AC-3 | 通过 | 同宿主SVG两条path，右侧分隔线；收起48px再展开恢复宽度，aria状态正确 |
| AC-4 | 通过 | 共享组件回调未改，meiji相关42项测试通过 |

## 测试
- `npm run test:drama`：基线34通过；修改后34通过，0失败、0取消。
- `node --test projects/meiji/tests/ui-navigation.test.js projects/meiji/tests/ui-lifecycle.test.js projects/meiji/tests/api-session.test.js`：42通过、0失败、0取消。
- Playwright使用已安装Google Chrome验证在线drama，无需下载浏览器；light/dark、hover/focus、图标/折叠/恢复、返回片库通过，浏览器无运行错误。
- 日志：/tmp/drama-settings-ui-{after,meiji,browser}.log。截图：/tmp/drama-settings-20261021.png。
- git diff --check通过。

图谱工具最初将三个UI符号标为CRITICAL且缺少UID，返回媒体转换、数据迁移等不可能的访问关系；detect_changes同样误关联大量流程。已警示并用实际import检索核对：renderSettings也由meiji使用，createShell和drama.mount只由本项目使用；以两项目回归与真实浏览器验证补充，不把异常图谱当成通过依据。最终索引刷新成功（8712节点、35427边），但detect_changes仍将少量UI改动关联到439条流程并评为CRITICAL，工具关系异常尚未解决，未宣称图谱验收通过。未改动Harness源码或图谱实现。

## 人工待办
用户刷新现有页面加载新CSS/JS；静态资源接口no-store，无需重启服务。没有真实模型调用。

用户追加布局调整：返回按钮仅保留箭头，与设置标题放在同一行，保留aria-label和提示标题。新增settings-heading容器，不使用会继承宿主header样式的标签。drama34项通过，真实Chrome中箭头/标题中心对齐（偏差小于1px）且返回功能通过。
