# drama UI

这里的初始UI从meiji复制，随后在drama独立维护。表单与展示组件由业务传入数据/回调；workbench.js负责drama面板接入。两个项目不互相导入组件、样式或静态资源；每次复用都复制实际源码并改为目标项目内部引用。

- `project-forms.js`：`projectDialog(root, save, { listScripts, readScript })` 创建项目；素材库读取由调用方提供，未提供时隐藏素材库选择按钮。drama传入本地素材库接口，在“导入剧本”旁展示“从素材库导入”。`detailsDialog(root, title, values, save, options)` 编辑项目/剧集资料。
- `project-detail.js`：`renderProjectDetails(root, basicInfo)` 展示项目基本资料和原始剧本。
- `settings-ui.js`：`renderSettings(root, { settings, saveSettings, back, busy })` 展示语言设置；`renderModelSettings(root, { settings, modelOptions, saveSettings, busy })` 展示模型设置。
- `panel-dom.js`：DOM 创建及面板弹窗交互。
- `project-ui.css`：表单、弹窗、设置及项目资料样式，由宿主加载至对应文档或 ShadowRoot。容器排版继续由宿主面板负责。

`save` / `saveSettings` 支持异步回调，拒绝时显示错误并保留表单或恢复选项。组件不导入 meiji 模块，也不直接请求 meiji API。

- `workbench.js`：顶部固定“短剧制作”标题和创建按钮；从任意页面打开创建弹窗，项目创建后进入新会话。
- `library-ui.js`：项目/素材两层导航，素材分人物、衣服、道具、剧本；状态由外层持有，返回时保留分类。项目列表打开原会话；剧本文件可导入独立素材库，供创建项目复用。人物/衣服/道具本次只提供分类展示。组件销毁后忽略晚到响应。

业务接口由 `../http/library_routes.js` 提供，需Harness认证，不要求当前会话。素材保存于 `$DSH_HOME/storages/drama/library/<asset_id>/`：metadata.json为列表资料，content.txt为剧本正文；临时目录完成后才发布。支持TXT/Markdown，正文上限1MiB。项目列表经CreateProjectTool与ProjectManager读取已完成创建的项目。

标题下的HTTP记录和任务记录分别挂载http-client/ui和task/ui。`/plugins/drama/packages/`只映射白名单内的公共UI模块，不读取meiji项目源码。记录由`src/records/service.js`管理，保存在`$DSH_HOME/storages/drama/records.sqlite`，插件销毁时关闭数据库；公共历史页面读取drama全局记录，不要求先创建项目。业务节点目录由drama提供。

后续执行器通过`ctx.drama.records.tasks`注册/提交任务（scope使用`records.scope`），按执行调度时机start；HTTP请求将`records.http.record`作为record回调。现阶段尚未实现的节点执行器不会产生虚构历史，旧meiji数据不迁入。
