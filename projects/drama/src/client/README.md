# drama UI

这里承接 meiji 重构中的 UI。当前只迁移组件、表单交互及样式，不提供 drama 的 HTTP、存储或业务执行逻辑。meiji 保留原入口并调用这些组件。

- `project-forms.js`：`projectDialog(root, save, { listScripts, readScript })` 创建项目；素材库读取由调用方提供，未提供时隐藏素材库选择按钮。`detailsDialog(root, title, values, save, options)` 编辑项目/剧集资料。
- `project-detail.js`：`renderProjectDetails(root, basicInfo)` 展示项目基本资料和原始剧本。
- `settings-ui.js`：`renderSettings(root, { settings, saveSettings, back, busy })` 展示语言设置；`renderModelSettings(root, { settings, modelOptions, saveSettings, busy })` 展示模型设置。
- `panel-dom.js`：DOM 创建及面板弹窗交互。
- `project-ui.css`：表单、弹窗、设置及项目资料样式，由宿主加载至对应文档或 ShadowRoot。容器排版继续由宿主面板负责。

`save` / `saveSettings` 支持异步回调，拒绝时显示错误并保留表单或恢复选项。组件不导入 meiji 模块，也不直接请求 meiji API。
