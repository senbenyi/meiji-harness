# dsh-elysium

视频生成插件。提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及任务恢复。

## 源码结构

```text
src/
├── business/                 # 内部业务包，随插件一起构建和发布
│   ├── projects/             # 项目、锚点、分镜与交付数据
│   ├── directors/            # 导演库
│   ├── assets/               # 素材库索引、查询与访问校验
│   ├── jobs/                 # 任务持久化、查询、诊断与进程锁
│   ├── video/                # 单次视频任务、执行、worker 与恢复
│   └── production/           # 多镜头生产清单、编排、回执与参考帧
├── servers/                  # 按 registry/runtime/transport/providers 分包
│   ├── registry/             # 配置与目标解析
│   ├── runtime/              # 平台加载、调度与任务归属
│   ├── transport/            # 连接建立与复用
│   └── providers/            # 平台实现及各自的工作流模板
│       └── runpod/workflows/ # 原有 H3 图构建、档位配置和完整模板
├── comfyui/                  # 公共 ComfyUI 协议、提交与媒体引用
├── tools/                    # Harness 聊天工具入口
├── http/                     # HTTP 路由适配
├── client/                   # 创作工作台与聊天界面
├── prompts/                  # 系统提示词
├── config.js                 # 插件运行配置
└── index.js                  # 插件装配入口
```

## 提供者边界

外部代码只通过 `src/servers/runtime/index.js` 路由，不直接加载适配器或访问 registry/transport 内部模块。该入口提供后端选择、参数校验、执行、原任务恢复、连接检查、参考帧和工作流同步能力。

各 `src/servers/providers/<id>/` 拥有自己的 `index.js`、公开声明 `definition.json`、能力说明、参数校验、API/部署实现和测试；需要文件配置的提供者另带配置模板。当前实际实现包括 Runpod、BytePlus、百炼和手工连接兼容适配器；其余预留目录不表示可用。手工连接的历史工作流委托在自身声明中显式指定，并经过同一入口调用。

`servers/registry` 负责通用登记与身份，`servers/transport` 负责通用连接，`comfyui/` 负责可复用协议；这些公共模块不包含厂商或模型专属分支。业务层只负责项目、任务和多镜头编排。实际凭据仍位于本机忽略文件中，不进入源码目录。

新增提供者通过自己的目录声明配置、能力与渠道优先级，无需在业务、界面或 Harness 中添加厂商判断。`provider-boundary.test.js` 检查导入边界；`provider-removal.test.js` 验证物理删除提供者后的独立运行及旧任务拒绝误路由。

## 短剧快速预览

- 调用 `workflow_generate_video(project_id, preview)`
- 支持 `t2va` 或带 `first_frame` 服务器图片 URL 的 `i2va`。
- 当前预览为 H3、384×512、73 帧、24fps、8 步，约 3.04 秒。
- 配置位于 `src/servers/providers/runpod/workflows/minimax-h3/profiles/preview.json`。

## 三方视频渠道

自有视频模型可连接时优先使用自有模型；否则在已启用渠道中优先选百炼，再选 BytePlus。两者配置独立，任务提交后固定后端，恢复不会切换供应商或再次付费提交。

- 百炼：运行配置位于 `$DSH_HOME/storages/elysium/config/settings.json` 的 `providers.bailian`。字段模板位于 `src/servers/providers/bailian/config.example.json`；填写原生 DashScope `base_url` 和 `api_key` 后设置 `enabled: true`。
- 万相 2.6：`t2va` 使用 `wan2.6-t2v`，`i2va` 使用 `wan2.6-i2v`；2–15 整数秒，720P/1080P，默认自动生成音频。文生视频比例取配置，图生视频比例随首帧；首帧支持 `job:图片素材ID`、HTTPS URL 和图片数据。不支持首尾帧、双参考图模式，不会静默丢弃素材。
- BytePlus：仅提供 Seedance 视频渠道；运行配置位于 `settings.json` 的 `providers.byteplus`，字段模板位于 `src/servers/providers/byteplus/config.example.json`。
- 百炼关闭开关只影响新任务选择；已提交任务保留原 ID，可恢复查询、下载。未知提交结果禁止自动重发，需先核对供应商任务；任务查询及产物链接受供应商有效期限制。
- 工作台只显示图片、视频及三方模型选择；API 密钥不进入任务快照和模型列表。

## 本机配置边界

仓库中的 `config/defaults.json` 只负责初始化非敏感默认值。实际运行设置唯一保存到 `$DSH_HOME/storages/elysium/config/settings.json`，包括聊天模型与隧道、图片/视频模型目录、服务器连接、当前模型选择和三方渠道配置。该文件包含凭据，始终使用 `0600` 权限；浏览器接口不会返回密钥和 SSH 连接细节。插件实例参数可临时覆盖原子工具开关与模型目录。

`ELYSIUM_HOME` 默认 `$DSH_HOME/storages/elysium`（`DSH_HOME` 默认 `~/.dsh`），根目录只承载五类数据：`config/` 保存唯一的 `settings.json`，`pools/` 保存导演库和素材库索引等跨项目主数据，`projects/` 保存项目拥有的业务、任务、生产回执与媒体，`runtime/` 保存跨会话索引、隧道和迁移归档，`uploads/` 保存用户导入原件。`pools/materials.json` 仅记录全局素材的身份、来源和删除状态，媒体实体仍位于所属 `projects/` 或 `uploads/`；项目内的 `materials.json` 只是引用集合。Harness 的文本模型由 Harness 自身动态路由，Elysium 不修改 `~/.dsh/settings.yaml`。

旧安装可执行以下命令做一次迁移；脚本将 `servers.json`、`selection.json` 和 `providers/*.json` 合并到 `settings.json`，复读校验后把旧文件移动到 `runtime/migrations/<timestamp>/settings-sources/`：

```sh
pnpm migrate:home
```

## 构建

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
node harness/scripts/install.mjs
```

## 工作流同步

```sh
pnpm workflow:sync       # 从当前选中平台的 ComfyUI 同步 UI 图，编译 API 图并更新 SHA-256
pnpm workflow:check      # 只读核验，不修改文件
node --test tests/runpod-h3-workflow-sync.test.js
```
