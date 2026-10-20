# drama 界面迁移

- 类型：重构
- 目标：将项目详情、添加项目、设置 UI 实现归入 drama/client，meiji 保留入口并传入业务回调。
- 非目标：不修改项目字段、数据存储与任务执行链；不新增 drama 服务端。用户补充：本次只迁移 UI，业务逻辑稍后实现。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | meiji 创建/编辑项目 → 使用 drama UI，保持保存内容与校验 | 已确认 | project-forms.js、workbench.js |
| AC-2 | 打开设置 → 语言及四类模型可保存，失败恢复原值 | 已确认 | task-panel.js、workbench.js |
| AC-3 | 浏览器加载 meiji → 新模块及样式均可加载 | 已确认 | task-routes.js 静态白名单需同步 |
| AC-4 | drama client → 不导入 meiji 模块或硬编码 meiji API | 已确认 | 使用回调传入素材读取与保存 |

## 调用链与证据
meiji workbench → projectDialog / renderSettings；task-panel → renderOverview → detailsDialog。
GitNexus 索引已更新；projectDialog、detailsDialog、renderSettings、renderOverview 风险 CRITICAL，影响导航及弹窗；createTaskHttpHandler 风险 LOW。静态模块加载另由 HTTP 测试确认。

## 待用户决定
无。已确认保留 meiji 入口，UI 源码集中 drama/client；drama 是重构目标。

## 改动
1. drama/client：迁移表单、项目基本资料、设置及必要 DOM 与样式；通过回调连接业务。
2. meiji/client：更新调用方并删除迁出的实现。
3. meiji/server/http/task-routes.js：服务迁移后静态模块。
4. tests：更新导入，验证 UI 交互及真实 HTTP 模块图。

## 验证
迁移前后运行 UI、视频服务、模型设置、API 及 drama 测试，收尾运行完整测试、diff --check、detect-changes 并更新索引。

## 验证结果
npm ci 后基线与迁移后相关测试均 82 通过、0 失败、0 cancelled；完整 npm test：792 通过、0 失败、0 cancelled；真实 HTTP 模块图及 CSS 请求通过；git diff --check 通过。drama 独立业务运行未实现，未进行人工浏览器视觉验收。
