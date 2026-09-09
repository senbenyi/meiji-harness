# 工具执行链路与职责

本次重构集中在 `dsh-elysium-tools/src/`，不改变工具名、参数 schema、工作流模板、任务 ID、状态文件名及产物目录。模型仓库、ComfyUI 引擎及 UI 仅核对，没有修改或部署。

## 从会话到产物

下表中的插件路径相对 `dsh-elysium-tools/src/`。

| 环节 | 代码路径 | 责任与边界 |
| --- | --- | --- |
| Harness 会话 | `index.js`、`tool-discovery.js`；包内 `presets/elysium/instructions.md`、`presets/elysium/skills/creation-*` | 注册生产工具、按会话加载通用工具；Harness 保留权限和工具调用执行权 |
| 工具参数 | `functions/endpoint/`、`workflows/workflow-generate-video.js` | 默认值与兼容入口转换；镜头时长、提示词及素材不能被静默缩减 |
| 输入校验 | `workflows/video-plan.js`、`media-plan.js` | 视频镜头模式、种子、总时长、素材类型及 artifacts 路径边界；不提交任务 |
| 创建与恢复 | `jobs/create.js`、`call-index.js`、`launch.js`、`launch-lock.py`、`wait.js` | 保存请求，绑定会话调用，串行启动后台 worker，等待原任务 |
| worker 分发 | `workflows/video-worker.js` | 按持久化请求分发视频或图片／合片执行；保留原路径供存活进程识别 |
| 工作流选择 | `workflows/video-graph.js`、`media-graph.js` | 单生成镜头用 generate，多镜头或 reuse 用 director；图片按是否带参考图选择模板，合片用 concat |
| 图与素材 | `workflows/video-workflow.js`、`templates/`、`media/probe.js` | 探测真实素材、上传，绑定模板参数，生成相同节点 ID 的 API 图与可视化图 |
| 公共执行 | `workflows/comfy-execution.js`、`video-execution.js`、`media-execution.js` | 快照复用、准备／提交／等待／验收阶段编排；不在插件内实现模型采样 |
| HTTP 与提交记录 | `functions/comfyui/client.js`、`jobs/comfy-submission.js`、`json.js` | 上传、schema 检查、`/prompt`、队列／历史查询及 `/view` 下载；提交意图和 prompt_id 持久化 |
| 远端执行 | ComfyUI `main.py`、`execution.py`、`comfy/samplers.py` 及节点实现 | 取队列、依赖调度、缓存、节点执行与模型采样 |
| 解码与导出 | VAE、`ElysiumSelectFrames`、`ImageScale`、音频节点、`DaSiWa_EnhancedVideoCombine` | ComfyUI 内完成解码、按时间裁剪／取帧、缩放、音轨整理和 FFmpeg 编码封装 |
| 插件验收 | `workflows/video-artifacts.js`、`media-artifacts.js`、`video-validation.js`、`media/probe.js` | 下载候选文件，探测规格及完整解码；视频逐镜和成片均通过后才交付最终结果 |
| 回传展示 | `jobs/query.js`、`functions/common/tool.js`、`http/media-jobs.js`；UI `src/client/media/` | 返回摘要、按可信会话绑定查询状态，提供预览／下载及同源播放回退 |

`functions/common/task.js`、`workflows/video-publication.js` 保留旧导入路径的薄导出；内部消费者直接依赖所属模块。旧非 ComfyUI 视频的读取／发布兼容保留在 `jobs/query.js` 与 `legacy-video.js`，不接入新任务执行。

## 恢复与交付契约

- `ELYSIUM_TOOLS_STATE_ROOT/jobs/<job_id>/` 保留 `input/request.json`、`status.json`、`worker.lock`、`launch.lock`、`comfyui-workflow.json`、`comfyui-submission.json`、`resume-request.json` 等原文件名。
- 重构后恢复仍使用原请求、服务地址和已保存执行图；旧快照缺少可视化图时不重建、不重新上传素材。
- POST 前记录提交意图；响应丢失时按插件任务 ID 查原队列与历史。结果不明不重提；显式恢复且确认原 prompt 执行失败后才能重提。
- 下载或验收失败只恢复下载／验收；等待中断不取消后台任务。存活 worker 不重复启动，无法确认进程身份时不抢占锁。
- `ARTIFACTS_ROOT/production-<job_id>/output/final.*` 保持不变；视频逐镜位于 `shots/<shot_id>.mp4`。生成成功仍须人工审片，`human_review` 保持 `not_run`。
- 图片／合片和视频保留各自验收规格，尤其合片允许无音轨，不能套用视频生产必须有 AAC 音轨的约束。

## 外部路径核对

模型仓库为相邻 `llm-ai-model/`，运行时插件只使用包内模板：

- `workflows/video-generate-minimax-h3/` → `scripts/common/comfyui/build_video_workflows.py` → 两份视频模板。
- `workflows/image-generate-sdxl/`、`workflows/video-concat/` → `scripts/common/comfyui/build_image_concat_workflows.py` → 三份图片／合片模板。
- `scripts/common/comfyui/elysium_media.py` 定义 `ElysiumSelectFrames`；`app/deploy_workflows.sh` 安装它，更新后需要按授权重启 ComfyUI。
- `app/start_comfyui_minimax.sh` 管理引擎、DaSiWa、IP-Adapter 版本及模型完整性；H3 VAE 补丁位于 `scripts/modules/video-generate-minimax-h3/patches/vae-tile-batch.patch`。

2026-09-09 只读检查远端 `/root/autodl-tmp/ComfyUI-minimax-h3`：

- 引擎 HEAD 为 `1aec3a1351f7f5b7280553569a0dbef993b79e45`，DaSiWa HEAD 为 `4bf05f88b1170f66eb21208cf4b32dd9f8d4fa26`，与本地启动脚本约束一致；未据此宣称工作目录或模型权重完全无漂移。
- `main.py:351` 的 `prompt_worker`、`execution.py` 的 `PromptExecutor`／`PromptQueue`、`comfy/samplers.py` 的 `CFGGuider` 和 `comfy/sd.py` 的 VAE 解码入口均已定位。
- Director 位于 `custom_nodes/ComfyUI-DaSiWa-Nodes/nodes/nodes_minimax_h3_director_guide.py`；编码封装位于同目录 `nodes_enhanced_video_combine.py`，通过 FFmpeg 执行。
- `/object_info` 确认 H3、IP-Adapter、图片、音视频、`ElysiumSelectFrames` 等依赖已注册；五份模板共 184 个节点实例的必填输入、连线类型与静态枚举选择检查无错误。上传素材的动态文件选择不参与静态枚举检查。

## 验证与发布边界

- 工具基线 58 项测试；重构后 60 项通过、无跳过，新增旧快照恢复和图片损坏后的原 prompt 恢复回归。
- UI 26 项测试通过，覆盖卡片状态、播放、图片、凭据更新及同源回退。
- 两个导出器的 `--check` 共检查五份模板，全部一致；没有重新导出或改动模板。
- 构建脚本递归复制整个 `src/` 至 `lib/`，registry 打包完整 `lib/`；因此新增目录及迁移的 Python 锁脚本仍在复制范围内。本次仅静态核对，未执行构建、打包或部署。
- 未提交新的 ComfyUI 推理任务、未重启服务，也未验收新的自然语言会话或内容质量。HTTP 模拟测试和在线 schema 检查不能替代 GPU 推理验收。

复查命令（在各自仓库或插件目录执行）：

```sh
# llm-dsh-plugins/dsh-elysium-tools
pnpm test
# llm-dsh-plugins/dsh-elysium-ui
pnpm test
# llm-ai-model
python3 -B scripts/common/comfyui/build_video_workflows.py --check
python3 -B scripts/common/comfyui/build_image_concat_workflows.py --check
# llm-dsh-plugins
git diff --check
```

## 独立插件配置

配置定义与校验在插件 `src/config.js`，通过 Cordis 节点接入，见 [独立安装配置](../dsh-elysium-tools/README.md#独立安装配置)。工具及 HTTP 回调使用对应实例的配置上下文，worker 显式继承配置；不修改宿主环境。

新任务排队时标记 `backend: comfyui`，避免误入旧发布逻辑而要求服务器输出目录。独立实例回归清除旧环境变量，覆盖并发图片／视频任务、图片验收失败后的原 prompt 恢复、会话状态和媒体下载。使用模拟 ComfyUI 与本机媒体工具，不代表真实推理或本机 Harness 已安装验收。

独立配置改造后：工具测试 62 项、配置／部署／隧道测试 20 项通过；未构建、安装、部署或重启服务。

## 随包提供 Elysium 会话能力

`presets/elysium/` 包含原生 Agent composition、显示元数据、人格、协作指令及创作技能。bundle patch 通过安装 profile 的模块解析定位包内 preset 根目录；不依赖仓库位置。`agent.cordis.yml` 仅保留两处差异，由 `standard.mjs` 读取当前 Harness 的 standard 并应用原生补丁，通过原生分组挂载且不写回文件，保留权限执行链、平台条件和隔离分组，仅替换人格与追加包内技能目录。

`app/config/` 只供可选部署使用；部署器不再生成用户 preset、全局人格和 AGENTS.md，也不再同步仓库 `.dsh/`。现有用户文件保留，包内 preset 根目录在默认用户目录之前被发现。

迁移验证：将 package.json、bundle patch 和 presets 复制至含空格的临时包目录，在独立 profile 中模拟 workspace 链接，使用已安装 Harness 的原生解析、插值和 preset 发现器验证，没有引用原仓库 app/config 或 .dsh。复查命令：`node dsh-elysium-tools/tests/preset-installation.mjs /path/to/installed/dsh`。另用原生 Loader/Group 验证补丁求值、平台条件、嵌套分组及卸载，并确认标准预设未被写回；叶子工具使用探针替身，不调用真实模型或外部服务。这不是实际安装、服务重启或自然语言生成验收。

## 两个插件独立交付

媒体卡片、状态接口与生成工具统一由 tools 包提供；UI 包仅负责导演管理和按需读取，在普通 Harness 预设也可使用。两包分别提供 `config/` 示例，不依赖仓库部署目录。`app/config/` 的地址、模型选择、权限和隧道配置仅用于特定部署。

复查：`node --test tests/plugin-independence.test.mjs`。测试将源码和包配置复制到独立临时目录，分别加载 tools、UI 和两者组合，检查服务端工具、客户端入口及插槽是否冲突。只提供声明的第三方依赖，不链接另一个插件。此验证不替代真实安装、浏览器和 GPU 验收。

从旧版本升级两包时，应同时更新已安装的 UI 包：旧 UI 客户端仍包含媒体卡片，新版只由 tools 注册。
