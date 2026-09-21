# dsh-elysium

图片与视频生成插件。AutoDL provider 提供 RealVisXL/SDXL 文生图、参考图、角色三视图，以及 MiniMax H3 的 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 和 main 兼容导演工作流；任务恢复固定原服务器和 prompt。

## 源码结构

```text
src/
├── index.js                  # 唯一插件组合入口
├── config.js                 # 插件运行配置
├── client/                   # 浏览器 API、命令、任务卡与工作台
├── server/                   # Client 工作台 HTTP 路由与共享 Store
├── database/                 # 路径、原子 JSON 和集中数据管理器
├── session/                  # Harness 会话入口：预设、事件、工具投影、提示词
├── tools/                    # Harness 工具定义，执行交给 worker 门面
├── worker/                   # 持久化任务驱动（index.js 为唯一门面）
│   ├── manager/              # 受理、队列、派发、结算与管理命令
│   ├── driver/               # 对账、观察、结算、全局单并发派发循环
│   ├── intake/ routing/      # 受理与会话绑定；新任务模型路由
│   ├── store/ runner/        # 存储与状态机；worker 进程与 TaskContext
│   ├── results/              # 结果汇总与诊断
│   └── models/               # 模型层：contract、catalog、protocols、providers
└── utils/                    # 无业务语义的通用代码
```

## 任务流程

```
会话 → session 投影可见工具 → call_tools_load（按需）→ call_tools_image / call_tools_video
     → worker.submitTask：会话内复用 → routing（自有优先、三方回退）→ tasks/ 记录 + pending Job + driver 索引
     → driver：对账 → 结算 → 按泳道轮转选择 → 全局最多 1 个 runner 启动 worker 进程
     → worker 进程：TaskContext → models.executeJob → 状态经 store 状态机写入、产物经 store 登记
     → tools 等待结果 → results 汇总 → 工作卡渲染
     → 失败：Agent 在用户明确要求后调用 *_recover，或工作卡「重试原任务」按钮 → worker.retryTask
```

## 提供者边界

模型层以外的代码只通过 `src/worker/models/index.js` 访问模型，不直接加载适配器或访问 catalog 内部模块；新任务的后端选择位于 `src/worker/routing/`。Provider 在 worker 进程内通过 `executeJob(plan, backend, ctx)` 执行，只经 `contract.js` 定义的 TaskContext 写状态、保存产物和读取参考图，不导入任务层模块。

各 `src/worker/models/providers/<id>/` 拥有自己的 `index.js`、公开声明 `definition.json`、能力说明、参数校验、API/部署实现和测试；需要文件配置的提供者另带配置模板。当前实际实现包括 AutoDL、Runpod、BytePlus、百炼和手工连接兼容适配器。AutoDL 的模板和执行代码全部位于自身目录，不导入 Runpod；手工连接的历史工作流委托在自身声明中显式指定，并经过同一入口调用。

`worker/models/catalog/` 负责通用登记、身份与连接，`worker/models/protocols/comfyui/` 负责可复用协议与统一执行流程；这些公共模块不包含厂商或模型专属分支。业务层只负责项目、任务和多镜头编排。实际凭据仍位于本机忽略文件中，不进入源码目录。

新增提供者通过自己的目录声明配置、能力与渠道优先级，无需在业务、界面或 Harness 中添加厂商判断。`provider-boundary.test.js` 检查导入边界；`provider-removal.test.js` 验证物理删除提供者后的独立运行及旧任务拒绝误路由。

## 短剧快速预览

- 调用 `call_tools_video`，创作质量由系统设置控制
- 支持 `t2va` 或带 `first_frame` 服务器图片 URL 的 `i2va`。
- 当前预览为 H3、384×512、73 帧、24fps、8 步，约 3.04 秒。
- 配置位于 `src/worker/models/providers/runpod/workflows/minimax-h3/profiles/preview.json`。

## 短剧项目规划

导演保存在 `$ELYSIUM_HOME/pools/skills/director-<id>/SKILL.md`，工作台可编辑全文；导演的 `references/script.md`、`storyboard.md`、`shot-prompt-example.md` 叠加到对应规划步骤。通用规划 Skill 位于同一根目录的 `drama-planning/` 和 `shot-planning/`；Harness 安装脚本从 `harness/.dsh/storages/elysium/pools/skills/` 安装。

规划步骤为 `series`（剧情总览，含角色英文出图提示词）、每集 `timeline`、每集 `storyboard` 和逐镜 `shot-prompt`（中文视频提示词 + 英文首帧提示词）；生成或手改追加版本，定稿选择其中一版，上游重新定稿后下游需复核。

生产只经自动流水线（`src/server/projects/pipeline.js`），人工节点只有三个：

1. 定稿剧情总览：自动同步角色/场景锚点，并用正面站姿工作流为角色出参考图；场景只保留文字。
2. 确认锚点：参考图全部就绪后确认，之后才提交镜头。
3. 审看成片：需要时重拍单镜，流水线自动重新合成新版本。

「一键生产」（全部或到第 N 集）后，流水线按集定稿时间线、分镜和逐镜提示词；每镜先以首帧提示词 + 主角参考图生成与视频同比例的首帧，再图生视频（每次提交使用新种子）；镜头失败自动换种子重拍一次，仍失败则暂停并给出位置；上游变更影响已生成镜头时暂停，确认后级联；本集全部成功后合成（烧录字幕、响度 -16 LUFS）并登记 MP4 与 SRT。模型产物由 Worker 下载保存到 `projects/<id>/media/`，工作台只读本地文件。单集分镜、合成任务、交付记录保存在 `projects/<id>/episodes/<n>/`，自动生产状态保存在 `projects/<id>/auto.json`。

已知限制：画幅由创作质量档位决定（3:4 竖屏）；多人镜头只保证主角一致；跨镜音色依赖提示词描述；生产中不要切换创作质量。

## 三方视频渠道

自有视频模型可连接时优先使用自有模型；否则在已启用渠道中优先选百炼，再选 BytePlus。两者配置独立，任务提交后固定后端，恢复不会切换供应商或再次付费提交。

- 百炼：运行配置位于 `$DSH_HOME/storages/elysium/config/settings.json` 的 `providers.bailian`。字段模板位于 `src/worker/models/providers/bailian/config.example.json`；填写原生 DashScope `base_url` 和 `api_key` 后设置 `enabled: true`。
- 万相 2.6：`t2va` 使用 `wan2.6-t2v`，`i2va` 使用 `wan2.6-i2v`；2–15 整数秒，720P/1080P，默认自动生成音频。文生视频比例取配置，图生视频比例随首帧；首帧支持 `job:图片素材ID`、HTTPS URL 和图片数据。不支持首尾帧、双参考图模式，不会静默丢弃素材。
- BytePlus：仅提供 Seedance 视频渠道；运行配置位于 `settings.json` 的 `providers.byteplus`，字段模板位于 `src/worker/models/providers/byteplus/config.example.json`。
- 百炼关闭开关只影响新任务选择；已提交任务保留原 ID，可恢复查询、下载。未知提交结果禁止自动重发，需先核对供应商任务；任务查询及产物链接受供应商有效期限制。
- 工作台只显示图片、视频及三方模型选择；API 密钥不进入任务快照和模型列表。

## 本机配置边界

仓库中的 `config/defaults.json` 只负责初始化非敏感默认值。实际运行设置唯一保存到 `$DSH_HOME/storages/elysium/config/settings.json`，包括聊天模型、图片/视频模型目录、服务器 HTTP(S) 地址、当前模型选择和三方渠道配置。该文件包含凭据，始终使用 `0600` 权限；浏览器接口不会返回密钥和服务器地址。插件实例参数可临时覆盖原子工具开关与模型目录。

`ELYSIUM_HOME` 默认 `$DSH_HOME/storages/elysium`（`DSH_HOME` 默认 `~/.dsh`），根目录只承载五类数据：`config/` 保存唯一的 `settings.json`，`pools/` 保存导演库和素材库索引等跨项目主数据，`projects/` 保存项目业务、任务记录和执行记录，`runtime/` 保存跨会话索引、驱动索引和迁移归档，`uploads/` 保存用户导入原件。生成任务的不可变请求记录位于 `projects/tasks/`，执行记录位于 `projects/jobs/`，可重建派发索引位于 `runtime/driver.json`；这三处都不是缓存，项目目录本身不再包含 `jobs/`。`pools/materials.json` 仅记录全局素材的身份、来源和删除状态，媒体实体仍位于所属 `projects/` 或 `uploads/`；项目内的 `materials.json` 只是引用集合。Harness 的文本模型由 Harness 自身动态路由，Elysium 不修改 `~/.dsh/settings.yaml`。

AutoDL 保持两台服务器分工：ComfyUI 服务器同时承担图片和 H3 视频，Qwen 服务器承担 LLM。按 `src/worker/models/providers/autodl/server.example.json` 登记两个 server 后，将 `selection.selected.image` 与 `selection.selected.video` 指向 ComfyUI server；聊天配置继续指向 Qwen。实际 HTTP(S) 地址和凭据保存在本机 `settings.json` 中。切换只影响新任务，已有任务继续读取各自的 `input/backend.json` 快照。

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
