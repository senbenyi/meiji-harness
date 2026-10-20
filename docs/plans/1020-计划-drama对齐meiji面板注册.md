# drama 对齐 meiji 面板注册

- 类型：重构，完整流程。
- 目标：按 meiji 的 Web 脚本注入、body Shadow DOM面板壳、独立分界线、页面让位模式替换当前宿主内部DOM挂载方案。
- 非目标：不改宿主源码，不改创建项目/片库/设置业务；保留当前未提交的UI调整。

## 验收标准与调研结论
| AC | 状态 → 结果 | 依据 |
|---|---|---|
| AC-1 | 加载页面 → 注入脚本创建独立面板，不观察或改写宿主内部右侧容器 | meiji registerTaskPanel → panel.js → createShell |
| AC-2 | 拖动/方向键 → 面板宽度和root让位一致，刷新保留宽度 | meiji panel-shell.js |
| AC-3 | 收起/展开、窄屏 → 沿用48px折叠、移动端全宽与背景隐藏规则 | meiji panel-shell.js/panel-styles.css |
| AC-4 | 片库/设置/创建 → 当前UI保持可用；销毁清理监听与样式 | drama当前workbench，不覆盖本次前已有改动 |

## 证据与影响
meiji服务器和drama服务器均已有webserver/index-inject注册，问题在浏览器壳。旧drama panel.js使用MutationObserver、宿主按钮点击及React内部DOM挂载，全部移除。图谱panel.js为UNKNOWN，源代码确认由HTML注入动态加载；workbench符号图谱未找到，源码与现有HTTP/UI测试补证，不改业务函数。

## 改动
- drama/src/client/panel-shell.js、panel-shell.css：按meiji模式创建可拖动、可持久化、可折叠面板。
- drama/src/client/panel.js：改为动态加载壳与workbench，连接折叠按钮和销毁。
- drama/src/client/project-ui.css：移除对旧宿主内挂载方式的样式依赖，保留当前业务UI。
- drama/tests/panel-shell.test.js：拖动/键盘/持久化/销毁与移动端。

## 验证
相关单元测试与真实Chrome：页面让位、拖动后刷新、折叠、窄屏、片库/设置。完成后重启drama；diff --check、GitNexus检测及更新。

## 验证结果
drama相关28项测试通过，0失败、0cancelled。真实Chrome验证body挂载、360→460px拖动且root让位一致、刷新保留宽度、48px折叠及展开、片库/设置导航、600px移动端全宽与背景恢复，脚本错误0。diff --check通过。
