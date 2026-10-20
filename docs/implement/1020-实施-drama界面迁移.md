# drama 界面迁移实施记录

## 已修改文件
- `projects/drama/client/{project-forms.js,project-detail.js,settings-ui.js,panel-dom.js,project-ui.css,README.md}`：承接创建/编辑、项目基本资料、语言与模型设置 UI、DOM 交互及样式；说明组件回调契约。
- `projects/meiji/client/{workbench.js,project-ui.js,task-panel.js,panel-dom.js,panel-styles.css}`：使用 drama 组件，保留 meiji 入口与原有业务回调；删除旧表单实现 `project-forms.js`。
- `projects/meiji/server/http/task-routes.js`：注册 drama UI 静态资源及宿主路由。
- `projects/meiji/tests/{api-session.test.js,ui-navigation.test.js,video-service.test.js,ui-lifecycle.test.js}`：更新模块归属、回调与允许范围，验证真实 HTTP 加载全部迁移模块及样式。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | 创建、编辑、素材库选择与项目资料的既有 UI 测试通过 |
| AC-2 | 通过 | 语言/模型保存、错误恢复、运行中冻结回归通过 |
| AC-3 | 通过 | api-session 递归加载模块图，drama CSS HTTP 200 |
| AC-4 | 通过 | drama/client 无 meiji 模块导入或 meiji API 请求；仅注入回调 |

## 测试
- 首次因未安装依赖无法运行；npm ci 后相关基线 82 通过、0 失败、0 cancelled。
- 同范围迁移后 82 通过、0 失败、0 cancelled。
- 首轮完整测试发现旧生命周期检查限制模块必须位于 meiji，更新为允许 drama/client 后，npm test 共 792 通过、0 失败、0 cancelled。
- git diff --check 通过。GitNexus 影响覆盖弹窗、设置导航、静态资源，符合计划。

## 人工待办
未进行人工浏览器视觉验收。drama 业务逻辑按用户要求留待后续实现。
