# dsh-elysium

图片与视频生成插件。AutoDL provider 提供 RealVisXL/SDXL 文生图、参考图、角色三视图，以及 MiniMax H3 的 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 和 main 兼容导演工作流；任务恢复固定原服务器和 prompt。

## 源码结构

```text
src/
├── index.js                  # 唯一插件组合入口
├── config.js                 # 插件运行配置
├── client/                   # 浏览器 API、命令、任务卡与工作台
├── server/                   # HTTP 路由、领域服务、任务与工作流
├── database/                 # 路径、原子 JSON 和集中数据管理器
├── tools/                    # Harness 对外工具与提示词
├── models/                   # 协议、Provider 与运行管理器
└── utils/                    # 无业务语义的通用代码
```

## 提供者边界

外部代码只通过 `src/models/managers/runtime/index.js` 路由，不直接加载适配器或访问 registry/transport 内部模块。该入口提供后端选择、参数校验、执行、原任务恢复、连接检查、参考帧和工作流同步能力。

各 `src/models/providers/<id>/` 拥有自己的 `index.js`、公开声明 `definition.json`、能力说明、参数校验、API/部署实现和测试；需要文件配置的提供者另带配置模板。当前实际实现包括 AutoDL、Runpod、BytePlus、百炼和手工连接兼容适配器。AutoDL 的模板和执行代码全部位于自身目录，不导入 Runpod；手工连接的历史工作流委托在自身声明中显式指定，并经过同一入口调用。

`models/managers/registry` 负责通用登记与身份，`models/managers/transport` 负责通用连接，`models/protocols/comfyui/` 负责可复用协议；这些公共模块不包含厂商或模型专属分支。业务层只负责项目、任务和多镜头编排。实际凭据仍位于本机忽略文件中，不进入源码目录。

新增提供者通过自己的目录声明配置、能力与渠道优先级，无需在业务、界面或 Harness 中添加厂商判断。`provider-boundary.test.js` 检查导入边界；`provider-removal.test.js` 验证物理删除提供者后的独立运行及旧任务拒绝误路由。

## 短剧快速预览

- 调用 `workflow_generate_video(project_id, preview)`
- 支持 `t2va` 或带 `first_frame` 服务器图片 URL 的 `i2va`。
- 当前预览为 H3、384×512、73 帧、24fps、8 步，约 3.04 秒。
- 配置位于 `src/models/providers/runpod/workflows/minimax-h3/profiles/preview.json`。

## 三方视频渠道

自有视频模型可连接时优先使用自有模型；否则在已启用渠道中优先选百炼，再选 BytePlus。两者配置独立，任务提交后固定后端，恢复不会切换供应商或再次付费提交。

- 百炼：运行配置位于 `$DSH_HOME/storages/elysium/config/settings.json` 的 `providers.bailian`。字段模板位于 `src/models/providers/bailian/config.example.json`；填写原生 DashScope `base_url` 和 `api_key` 后设置 `enabled: true`。
- 万相 2.6：`t2va` 使用 `wan2.6-t2v`，`i2va` 使用 `wan2.6-i2v`；2–15 整数秒，720P/1080P，默认自动生成音频。文生视频比例取配置，图生视频比例随首帧；首帧支持 `job:图片素材ID`、HTTPS URL 和图片数据。不支持首尾帧、双参考图模式，不会静默丢弃素材。
- BytePlus：仅提供 Seedance 视频渠道；运行配置位于 `settings.json` 的 `providers.byteplus`，字段模板位于 `src/models/providers/byteplus/config.example.json`。
- 百炼关闭开关只影响新任务选择；已提交任务保留原 ID，可恢复查询、下载。未知提交结果禁止自动重发，需先核对供应商任务；任务查询及产物链接受供应商有效期限制。
- 工作台只显示图片、视频及三方模型选择；API 密钥不进入任务快照和模型列表。

## 本机配置边界

仓库中的 `config/defaults.json` 只负责初始化非敏感默认值。实际运行设置唯一保存到 `$DSH_HOME/storages/elysium/config/settings.json`，包括聊天模型与隧道、图片/视频模型目录、服务器连接、当前模型选择和三方渠道配置。该文件包含凭据，始终使用 `0600` 权限；浏览器接口不会返回密钥和 SSH 连接细节。插件实例参数可临时覆盖原子工具开关与模型目录。

`ELYSIUM_HOME` 默认 `$DSH_HOME/storages/elysium`（`DSH_HOME` 默认 `~/.dsh`），根目录只承载五类数据：`config/` 保存唯一的 `settings.json`，`pools/` 保存导演库和素材库索引等跨项目主数据，`projects/` 保存项目拥有的业务、任务、生产回执与媒体，`runtime/` 保存跨会话索引、隧道和迁移归档，`uploads/` 保存用户导入原件。`pools/materials.json` 仅记录全局素材的身份、来源和删除状态，媒体实体仍位于所属 `projects/` 或 `uploads/`；项目内的 `materials.json` 只是引用集合。Harness 的文本模型由 Harness 自身动态路由，Elysium 不修改 `~/.dsh/settings.yaml`。

AutoDL 保持两台服务器分工：ComfyUI 服务器同时承担图片和 H3 视频，Qwen 服务器承担 LLM。按 `src/models/providers/autodl/server.example.json` 登记两个 server 后，将 `selection.selected.image` 与 `selection.selected.video` 指向 ComfyUI server；聊天配置继续指向 Qwen。真实主机、SSH 身份和凭据只保存在本机 `settings.json`/SSH 配置中，不写入仓库。切换只影响新任务，已有任务继续读取各自的 `input/backend.json` 快照。

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
node scripts/deploy.mjs --provider autodl --check
```


## 项目视频创作

创作规则统一保存在 `resources/production-rules/`：`story-segments.md` 同步规划剧情与片段（`story.md` 保留旧请求兼容）、`scenes.md` 划分叙事场景、`segments.md` 规划生成片段与尾帧衔接、`shots.md` 编排分镜和运镜、`h3-prompt.md` 编写最终 H3 输入。每份包含输入、输出、判断规则和正反例。

`src/server/projects/production-rules.js` 在 `project_production_read` 时显式读取当前阶段文件：story 同时加载 story/scenes，其余 segments、shots、inputs 各加载对应一份，共四个文本 AI 阶段，每个阶段可有多批调用。`{{target_seconds}}` 注入项目当前时长；规则缺失直接报错，不回退到旧提示词。时长、素材 ID、会话和版本等硬校验仍在工作流与 schema 中执行。

Segment、分镜和 H3 输入每批最多 4 项。AI 根据 read 返回的 `request.batch.index` 提交 `data: {batch_index, segments}`，每次都是完整 JSON；本地校验通过后将暂存结果与批次回执保存在当前请求快照。回执 `request` 非空时继续读取下一批，全部时长或目标 ID 覆盖完成后才原子发布正式结果。合并剧情请求一次返回 `text/scenes`，每个 Scene 内包含 `segments`，由系统绑定归属并原子保存；旧剧情请求仍接受 `text/scenes`。不带批次编号的旧单次请求保留原全量校验；开始分批后必须继续携带编号。

部分批次不会覆盖已审核数据，也不会启动视频。重复提交相同批次直接返回已保存状态，内容冲突或顺序错误要求重新读取；失败批次不保存。重新打开项目可见已保存批数和条目数，点击“继续未完成批次”沿用原请求恢复；取消当前生成会丢弃该请求的暂存结果。Harness 默认千问输出上限为 32,768 tokens，批次不等于 Scene、Segment 或分镜的叙事切换。

这些文件是程序加载的运行资源，不是 Harness 自动发现的 Skill。修改源码目录的规则后执行 `pnpm build && pnpm package:registry` 并按现有方式部署；Registry 与 npm 包都包含 `resources/production-rules/`。每次阶段读取都会加载部署目录中的当前规则，已有剧情和视频不会自动重写。

桌面由左至右为 Harness 原生导航、项目/素材/设置列表、项目专属对话、当前项目详情。切换项目会同时切换对话与右侧数据，素材和设置独立保留。

在 Harness 中提出视频创作需求，AI 创建项目后自动打开右侧项目。流程卡片的下一步代表当前阶段已人工审核，通过后仅执行下一阶段：

1. 项目描述：保留原始输入，编辑创作要求、参考剧情、画幅、风格与目标时长。
2. 剧情与 Segment：一次执行，由 AI 同时生成完整故事、Scene 与场景内 4～15 秒片段，最多 100 段，填写人物、素材、动作与衔接；各场景内片段时长合计等于该场景时长。
3. 分镜与素材：每段编辑人物、服装、道具、场景、音乐、环境声及对白的描述/指定资源；生成参考图、选择项目共享素材，生成并逐镜审核分镜。
4. H3 输入：独立保存实际 Prompt、时长、画幅、模式、参考图和后端快照。总览提交全部待生成段；详情只提交当前段。批量严格等待前段完成，失败暂停、恢复复用原任务，完成后逐段更新。
5. 片段视频：保留生成历史，可播放、选择版本并局部重做。上游修改使下游过期，不删除历史视频。
6. 时间线成片：选择片段版本、排序、裁切、字幕、淡入淡出、片段音量和统一背景音乐，在媒体服务器使用 ffmpeg 合成。服务器探测实际时长，不下载媒体到本机。

项目模式目前共用流程，默认导演模式。新 UI 以 Scene/Segment 为准；旧项目保留原数据，通过“开始新流程”以旧剧情重新规划。详情有顶部返回和标题、滚动正文及底部操作栏，横向卡片每次展示 12 项，视频仅进入详情后按需加载。

数据保存于 `~/.dsh/storages/elysium/projects/<id>/production/revisions/<snapshot>/`，按 `story.json`、`assets.json`、`segments/<id>/`、`queue.json`、`timeline.json`、`exports.json` 分开存储；完整快照写完后才原子更新 `project.json.production_snapshot`。Segment 下保存片段资料、分镜、H3 输入版本和生成历史；原有 jobs 执行记录继续保留。

当前 AutoDL 实际部署为 `DasiwaMinimaxH3_dasiwaHybrid4turboV1.safetensors`，属于 H3 Turbo 衍生模型，并非官方 H3 Base。当前新流程支持文字或单张首帧图条件，其他指定素材作为文字描述参考，输入详情明确展示使用方式；多图、多音频原生条件未接入。参考图生成按用户在第 4 步点击触发，未指定素材时可以使用文字生成，不伪造图片 URL。最终画面一致性仍需人工验收。

服务器合片需要 ffmpeg、ffprobe、Python 和中文字体（Noto Sans CJK）。AutoDL 复用现有 ComfyUI Python 环境；合片进程独立运行并保存状态，Harness 重启后继续查询。测试覆盖 100 段时间线与冻结导出，真实服务器验证两段视频、裁切、中文字幕及混音；没有在回归中批量生成真实视频。
