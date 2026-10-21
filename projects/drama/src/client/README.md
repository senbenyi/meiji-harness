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

标题同排的HTTP记录和任务记录分别挂载http-client/ui和task/ui。`/plugins/drama/packages/`只映射白名单内的公共UI模块，不读取meiji项目源码。记录由`src/records/service.js`管理，保存在`$DSH_HOME/storages/drama/records.sqlite`，插件销毁时关闭数据库；公共历史页面读取drama全局记录，不要求先创建项目。业务节点目录由drama提供。

后续执行器通过`ctx.drama.records.tasks`注册/提交任务（scope使用`records.scope`），按执行调度时机start；HTTP请求将`records.http.record`作为record回调。现阶段尚未实现的节点执行器不会产生虚构历史，旧meiji数据不迁入。

Harness模型调用由drama根插件监听公开`llm/stream`事件，使用公共model-records记录器写入同一records.sqlite，包括主会话、标题、压缩及子会话经过该接口的调用。正文中保留sessionId与purpose。UI显示写入时保存的用途标题，不显示“模型调用”“历史还原”前缀，无HTTP状态码的成功返回显示“已完成”。插件关闭先保存模型流的部分返回，再关闭数据库；不修改外部Harness源码。

既有会话的回填条目标记`session-log-reconstruction`，包含原始调用时间和日志来源；此类条目不能视为适配器现场抓取或HTTP原始报文。


`project-overview.js`复制meiji的概要头部、编辑图标和无外框分区，按drama模型独立维护。目前只展示基本信息、只读可展开的原始剧本和剧本优化卡片；不展示剧集、人物等卡片。优化结果显示预估时长、摘要、正文预览，进入详情查看完整正文及节点状态。公共规则UI展示项目保存的基础规则与三动作补充规则，通过保存回调持久化。

资料编辑经`PATCH /api/drama/project?session_id=...`，需要Harness认证和`X-Drama-Request: 1`。请求包含`project_id`和`command`；只允许基本资料、明确的剧本导入、剧本执行意见与补充规则，携带旧值做冲突检测（409），绑定不符返回403。CreateProjectTool与创建共用串行队列；修改名称同步工作区，失败保留原项目。SSE通知同项目绑定会话刷新；切换会话关闭编辑弹窗，忽略晚到的UI结果。尚未接入生成执行器。


节点公共UI：剧本优化节点按需提供规则、任务记录、HTTP记录入口，直接挂载`prompt-composer/ui`、`task/ui`、`http-client/ui`。原始剧本只读，没有文本编辑器；创建时和已有项目均可从文件/素材库导入。节点记录请求携带`project_id`和`node_type`，业务层按任务/任务组`metadata.project_id`与步骤`http`筛选，列表和详情均隔离。未关联任务步骤的主Agent会话HTTP仅在全局记录显示；尚无节点执行记录时显示空列表，不推断归属。


连接管理：初始项目快照完成后再建立SSE，避免多标签页抢满浏览器HTTP/1连接。打开公共记录页时先释放本页SSE；后台及历史页不保持连接，前台返回项目自动恢复。连接恢复携带cursor，服务端补发暂停期间本会话最新的项目创建通知，保持创建项目后的会话跳转；不改变全局/节点记录的数据隔离。


当前项目详情按meiji原结构迁移（以此段为准）：`project-detail.js`实际复制原基本资料；`project-node.js`复制`task-panel.js`的剧本nodeCard/nodeUi与`project-ui.js`返回栏，保留标题/状态、操作区、执行意见、原因、正文与复制顺序，只适配drama.output。`project-ui.css`复制对应概要/节点选择器并限定项目页面，撤回此前自行压缩重排的样式。三个未接入的执行操作保持原位置但禁用，不调用meiji执行器。

`script-import.js`从已有创建弹窗复制文件/素材导入控件，保存命令为`import_script`（含previousValue），仅写`basic_info.original_script`；执行意见使用`node_opinion`写`script_revision.opinion`。旧值冲突拒绝，空/超限内容拒绝，其他节点及优化结果不被导入覆盖。相同SSE快照不重建项目视图，避免素材列表加载被销毁；保存成功使此前快照过期。没有运行时读取meiji源码或跨项目导入。

最新展示调整：按用户要求取消概要下方的“基本信息”整块，顶部保留模式/名称/画幅；project-detail只展示原始剧本标题和正文，直接展开且无折叠箭头。导入控件与剧本优化节点保留，项目资料数据及标题编辑能力不变。

用户澄清：仅去掉“基本信息”标题，内容恢复为项目ID、项目名称、创作要求、参考单集时长；下方重复模式/画幅不再显示，原始剧本保持直接展开。以此条覆盖前述“取消整块”的描述。

最新字段展示：顶部仅项目标题；创作模式和画幅与项目名称一样使用标签和值，在资料行各显示一次。字体层级仅作用于项目详情（标题18px、分区14px、正文/字段13px、操作12px），不改变导航和公共UI。

剧本节点操作区样式：执行按钮和公共记录/规则入口分两排，标题与操作区间距收紧，意见框与结果区统一间距；空正文仅展示弱化空态，不显示复制按钮，有正文仍可复制完整原文。仅调整布局和空态呈现，不新增执行能力。

用户要求重新设计节点局部：目前为标题/状态、轻量记录工具栏、意见与执行一体的操作容器、独立结果区。替代此前机械两排按钮布局；仍保留公共UI回调、意见保存及禁用状态，不影响项目资料与导航。

节点当前操作布局：仅输入区域有边框，输入框上方同一排左侧为任务历史/查看规则、右侧为按意见改编，改编文字为暖金色（保持既有禁用状态）。已删除人工编辑、审核剧本与节点内HTTP入口；顶部全局HTTP记录不变。

剧本节点标题为“剧本优化(可选)”。任务历史/查看规则在输入框上方各带按钮边框；不保留按钮间或结果分割线，空稿不渲染结果提示；已有结果及复制功能保留。


项目标题右侧的删除按钮需二次确认，经`DELETE /api/drama/project?session_id=...`提交`{ project_id }`，需要认证和`X-Drama-Request: 1`。服务端验证绑定，排队/执行中的本项目任务返回409；删除与创建/保存共用串行队列。删除先通过宿主`workspaceController.delete({ workspaceId })`移除绑定工作区登记，再在bindings请求行写`deleted_at`，片库列表/项目快照不再展示；会话、磁盘目录/项目文件及任务/HTTP记录保留。宿主删除失败不标记项目删除，可重试；仅`workspace/not-found`视为已删除，宿主已删但bindings未落盘时重启重试仍可完成。已软删除项目重复删除同样清理工作区登记。重复删除幂等，编辑或重试原创建请求返回410，不会恢复已删除项目。SSE刷新绑定页面，并清理该项目的创建通知补发缓存；客户端删除返回时校验当前会话，防止晚响应串项目。
