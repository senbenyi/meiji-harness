# 任务进度

状态流转：未开始 → 调研完成 → 待计划 → 待批准 → 实施中 → 待验收 → 已完成。

- 失败回退：根因未确认 → 回调研；方案明确 → 回计划。
- 每阶段结束前重新读取进度，回写状态、日期和下一步。
- 归档由用户处理，AI 不移动、删除文档。

## 待批准

(无)

## 实施中

- **项目分镜自动生成闭环** — `docs/plans/计划-项目分镜自动生成闭环.md` — 2026-09-19 阶段 1 完成，结构化 LLM 专项 4/4 通过；正在执行阶段 2 分镜生成与原子初始化。

- **main 分支 AutoDL 能力接入** — `docs/plans/计划-main分支AutoDL能力接入.md` — 阶段 1–4 完成，阶段 6 的 181 项插件测试、7 项 Harness 测试、构建、Registry 打包、安装与 Harness 重启完成；私有模型运行目录已补入 RealVisXL/SDXL、MiniMax H3 和既有 qwen3.8，并经运行接口回读。qwen3.8 已按当前 provider 规范改用环境凭据引用，DSH 真实调用通过。服务器选择和真实 T2I/T2V/I2V 验收仍待有效的 AutoDL ComfyUI 本机入口；当前 `veo-comfyui` 仍是失效 RunPod，历史 AutoDL 入口已拒绝连接。

## 待验收

- **持久化任务驱动** — `docs/implement/实施-持久化任务驱动.md` — 2026-09-19 阶段 0～6 完成：全局 Task/Job/Driver 存储、原子受理、全局单并发泳道驱动、恢复对账、至少一次 Sink 结算、Session 批量后台等待与项目回写已实现；实际 137/137 个 Job 可读，旧绝对路径迁移二次 dry-run 为 0；专项 9/9、插件 211/211、Harness 10/10、构建与 Registry 打包通过。因工作区存在并发 SSH 隧道改动，未将混合工作树安装到 Harness，待部署和真实生成验收。

- **Worker 任务管理器重构** — `docs/implement/实施-Worker任务管理器重构.md` — 2026-09-19 按「session → tools → worker 门面 → manager → intake/routing/store/runner/results → models」重建结构：图片与视频共用 `submitTask/retryTask` 流水线，Provider 改为经 TaskContext 执行，三份 ComfyUI 执行器合并，工作卡新增「重试原任务」按钮与 `POST /media/retry`；依赖方向由架构测试强制。插件测试 199/199、Harness 10/10、构建与 Registry 打包通过；待本机安装后人工验收真实生成与工作卡重试。

- **全局创作质量** — `docs/implement/实施-全局创作质量.md` — 2026-09-19 已将快速创作、常规创作、高清创作迁入设置并统一控制图片、视频和短剧；客户端命令目录与注册链路已彻底删除。专项测试 98/98、Harness 全量测试 10/10、构建和 Registry 打包通过；插件全量测试 191/192，唯一失败为沙箱禁止 `ps` 的既有环境限制。源码、构建产物和发布包残留扫描通过；本机安装被沙箱禁止写入 `~/.dsh`，待人工安装并重启验收。

- **设置统一存储** — `docs/implement/实施-设置统一存储.md` — 代码、临时迁移、169/170 项测试、构建和打包完成（2026-09-18）；本机 `settings.json` 已生成且与四个旧源一致。沙箱阻止旧源归档和 Harness 重启，需在本机终端完成两条人工命令后验收运行设置页。

- **产品闭环修复 v2** — `docs/plans/计划-产品闭环修复.md` — 阶段 1–6 全部实施完成（2026-09-12，95 个 Node 测试、2 个 Python 测试；项目级 17 个测试及 12 个子测试）；代码复核通过，无阻塞问题；下一步：在 Harness 中人工验收面板布局、素材筛选、项目/锚点/分镜/交付操作。

## 已完成

- **工具结果契约统一** — 2026-09-19 完成：六个媒体任务工具收敛为同一可扩展 Job 契约，视频成功/恢复与任务结果查询不再因字段漂移报 `INVALID_TOOL_OUTPUT`，自由模式内部项目 ID 不再投影。专项 22/22、插件 221/221、Harness 10/10、构建、打包、安装、重启与已安装真实视频契约核对通过。实施记录：`docs/implement/实施-工具结果契约统一.md`。

- **文件访问集中化** — 2026-09-19 完成：`src/database/files.js` 成为源码唯一文件系统入口，Server、Worker、Models 和配置层的 40 个直接入口全部迁移，媒体真实句柄由 Database 托管；新增架构防漂移测试。专项 50/50、插件 220/220、构建、Registry 打包和差异检查通过。实施记录：`docs/implement/实施-文件访问集中化.md`。

- **移除调用持久索引** — 2026-09-19 完成：运行中工具调用仅使用进程内关联，完成结果以 Harness 会话日志为事实源；删除 `runtime/calls` 的 24 个旧索引及全部读写逻辑。专项 38/38、插件 211/211、构建、Registry 打包、安装、Harness 重启和运行目录验证通过。实施记录：`docs/implement/实施-移除调用持久索引.md`。

- **Worker 任务目录迁移** — 2026-09-19 完成：原 `server/jobs` 与 `server/workflows` 迁入 `src/worker/tasks`，删除无用耗时采集后保留 16 个文件，按 jobs、images、videos、runtime、bindings 分层，Server 仅保留 Client HTTP、路由和共享 Store；专项测试 45/45、全量测试 187/188，唯一失败为沙箱禁止 `ps`，语法与构建通过。实施记录：`docs/implement/实施-Worker任务目录迁移.md`。

- **Worker 模型目录迁移** — 2026-09-19 完成：原 `src/models` 的 92 个文件整体迁入 `src/worker/models`，源码、测试、构建与文档路径已同步；Provider/架构专项 17/17 通过，构建通过，全量测试 187/188，唯一失败为沙箱禁止 `ps` 的已知环境限制。实施记录：`docs/implement/实施-Worker模型目录迁移.md`。

- **src 整体职责重构** — 2026-09-18 完成：源码按 client/server/database/tools/models/utils 重组，Database 集中数据入口且不反向依赖 Server，Utils 收敛为无业务语义通用代码，工具与图片工作流分离；190 项插件测试、10 项 Harness 测试、构建、Registry 打包、安装、重启与 3080 身份检查通过。实施记录：`docs/implement/实施-src整体职责重构.md`。

- **聊天模型隧道连接** — 2026-09-18 完成：私有聊天模型改为下拉框且显示 `qwen3.8`，按需连接/重新连接均成功，Harness 启动不建隧道；底层 API ID 保持 `qwen3.8-27b-elysium`，远端未修改或重启。170 项插件测试、7 项 Harness 测试、构建、打包和真实连接验收通过。实施记录：`docs/implement/实施-聊天模型隧道连接.md`。

- **素材库独立索引** — 2026-09-18 完成：`pools/materials.json` 作为全局素材库索引，项目引用与媒体实体保持原归属；真实索引 127 条（创作 124、导入 3）、权限 `0600`，Harness 已重启并通过运行核对。实施记录：`docs/implement/实施-素材库独立索引.md`。

- **Elysium 数据根目录、五类分层与导演链路修复** — 2026-09-18 完成：路径统一、无损迁移、导演链路、测试、构建、打包与 Harness 重启；954 个业务文件迁移前后清单一致，旧源归档到 `runtime/migrations/`；运行接口与 `pools/directors.json` 内容完全一致，`~/.elysium` 未重建。实施记录：`docs/implement/实施-Elysium数据目录分层.md`、`docs/implement/实施-Elysium数据根目录与导演链路修复.md`。

- **服务器职责分包** — `docs/implement/实施-服务器职责分包.md` — 2026-09-15 完成 registry/runtime/transport/providers 分包与 README 更新；155 项插件测试、16 项 Harness 测试、构建打包及发布指纹检查通过；模板 JSON 未改动。

- **Runpod 集中管理** — `docs/implement/实施-Runpod集中管理.md` — 2026-09-15 完成：专属测试、旧运维/制作材料以及完整模板/档位/图构建/同步编译器归入 providers/runpod；按用户纠正恢复全部模板原始字段并逐字节验证；撤销根目录 runpod；155 项插件测试、16 项 Harness 测试、构建打包及删除平台验收通过。

- **业务包集中** — `docs/implement/实施-业务包集中.md` — 2026-09-15 完成：六个业务目录归入 business，H3 工作流归入 comfyui/workflows/minimax-h3；README 与结构约定更新；两步插件测试各 154 通过、构建与发布包检查通过、Harness 全量 16 通过，测试隔离修正后 6 项复验通过。

- **平台适配器可替换** — `docs/plans/计划-多服务器平台扩展.md` — 2026-09-15 按阶段 1–4 完成；154 项插件测试、8 项 Harness 测试、构建及差异格式检查通过；物理删除 Runpod 后的独立测试适配器完整业务验收通过。实施记录：`docs/implement/实施-平台适配器可替换.md`。真实其他平台仍仅预留，接入和画质未验收。

- **项目架构优化** — `docs/plans/计划-项目架构优化.md` — 预设去重、构建目录统一、空目录清理（2026-09-12 完成，AC-1～AC-6 全部通过）
