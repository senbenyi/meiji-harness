# 工具执行链路与职责

当前实现保留工具名、任务 ID 与工作流恢复机制；媒体仅通过 HTTP 引用，不上传、下载或保存副本。详见 [HTTP 媒体约定](media-http-only.md)。下方历史验证数据按原记录保留，不代表本次修改已部署。

## 从会话到产物

下表中的插件路径相对 `dsh-elysium-tools/src/`。

| 环节 | 代码路径 | 责任与边界 |
| --- | --- | --- |
| Harness 会话 | `index.js`、`tool-discovery.js`；包内 `.dsh/.agent-presets/elysium/rules.md`、`.dsh/.agent-presets/elysium/skills/creation-*` | 注册生产工具、按会话加载通用工具；Harness 保留权限和工具调用执行权 |
| 工具参数 | `functions/endpoint/`、`workflows/workflow-generate-video.js` | 默认值与兼容入口转换；镜头时长、提示词及素材不能被静默缩减 |
| 输入校验 | `workflows/video-plan.js`、`media-plan.js` | 视频镜头模式、种子、总时长、ComfyUI HTTP 素材引用边界；不提交任务 |
| 创建与恢复 | `jobs/create.js`、`call-index.js`、`launch.js`、`launch-lock.py`、`wait.js` | 保存请求，绑定会话调用，串行启动后台 worker，等待原任务 |
| worker 分发 | `workflows/video-worker.js` | 按持久化请求分发视频或图片／合片执行；保留原路径供存活进程识别 |
| 工作流选择 | `workflows/video-graph.js`、`media-graph.js` | 单生成镜头用 generate，多镜头或 reuse 用 director；图片按是否带参考图选择模板，合片用 concat |
| 图与素材 | `workflows/video-workflow.js`、`templates/`、`media/probe.js` | 通过 HTTP 读取必要输入信息、复用后端引用，绑定模板参数，生成相同节点 ID 的 API 图与可视化图 |
| 公共执行 | `workflows/comfy-execution.js`、`video-execution.js`、`media-execution.js` | 快照复用、准备／提交／等待／验收阶段编排；不在插件内实现模型采样 |
| HTTP 与提交记录 | `functions/comfyui/client.js`、`jobs/comfy-submission.js`、`json.js` | schema 检查、`/prompt`、队列／历史查询及 `/view` 地址构造；提交意图和 prompt_id 持久化 |
| 远端执行 | ComfyUI `main.py`、`execution.py`、`comfy/samplers.py` 及节点实现 | 取队列、依赖调度、缓存、节点执行与模型采样 |
| 解码与导出 | VAE、`ElysiumSelectFrames`、`ImageScale`、音频节点、`DaSiWa_EnhancedVideoCombine` | ComfyUI 内完成解码、按时间裁剪／取帧、缩放、音轨整理和 FFmpeg 编码封装 |
| 插件验收 | `workflows/video-artifacts.js`、`media-artifacts.js` | 从最终节点 history 构造 HTTP 地址；不拉取产物或声称完整解码通过 |
| 回传展示 | `jobs/query.js`、`functions/common/tool.js`、`http/media-jobs.js`；UI `src/client/media/` | 返回摘要、按可信会话绑定查询状态，提供 HTTP 预览与认证重定向，无本地文件回退 |

`functions/common/task.js` 保留工具公共导出；旧媒体文件复制发布和本地文件回传实现已删除。

## 恢复与交付契约

- `ELYSIUM_TOOLS_STATE_ROOT/jobs/<job_id>/` 保留 `input/request.json`、`status.json`、`worker.lock`、`launch.lock`、`comfyui-workflow.json`、`comfyui-submission.json`、`resume-request.json` 等原文件名。
- 重构后恢复仍使用原请求、服务地址和已保存执行图；旧快照缺少可视化图时不重建、不补传素材。
- POST 前记录提交意图；响应丢失时按插件任务 ID 查原队列与历史。结果不明不重提；显式恢复且确认原 prompt 执行失败后才能重提。
- HTTP 查询失败后恢复原任务查询；等待中断不取消后台任务。存活 worker 不重复启动，无法确认进程身份时不抢占锁。
- 输出与逐镜 `path` 均为 HTTP 地址，插件不创建媒体产物目录。生成成功仍须人工审片，验收字段保持 `not_run`。
- 工作流仍保留图片／合片和视频的生成规格；插件不通过下载产物验证规格。

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

新任务排队时标记 `backend: comfyui`，避免误入旧发布逻辑而要求服务器输出目录。独立实例回归清除旧环境变量，覆盖并发图片／视频任务、图片执行失败后的原任务恢复、会话状态和 HTTP 重定向。使用模拟 ComfyUI 与本机媒体工具，不代表真实推理或本机 Harness 已安装验收。

独立配置改造后：工具测试 62 项、配置／部署／隧道测试 20 项通过；未构建、安装、部署或重启服务。

## 随包提供 Elysium 会话能力

`.dsh/.agent-presets/elysium/` 包含原生 Agent composition、显示元数据、人格、协作指令及创作技能。安装后复制到 `$DSH_HOME/.agent-presets/elysium/`，由 Harness 默认发现；bundle 不再注册额外预设目录。`agent.cordis.yml` 直接声明原生 standard 工具、平台条件和隔离分组，仅替换人格与技能目录；不使用自定义加载脚本。Harness 升级后可核对标准预设差异。

`app/config/` 只供可选部署使用。部署器首次复制包内预设，已有同名预设保留；不写全局 AGENTS.md。手动安装按插件 README 复制目录。

迁移验证：把包内 `.dsh/` 复制到临时宿主目录后删除临时插件包，使用已安装 Harness 的原生发现器验证资源独立加载。复查命令：`node dsh-elysium-tools/tests/preset-installation.mjs /path/to/installed/dsh`。另用原生 Loader/Group 验证补丁求值、平台条件、嵌套分组及卸载，并确认标准预设未被写回；叶子工具使用探针替身，不调用真实模型或外部服务。这不是实际安装、服务重启或自然语言生成验收。

## 两个插件独立交付

媒体卡片、状态接口与生成工具统一由 tools 包提供；UI 包仅负责导演管理和按需读取，在普通 Harness 预设也可使用。tools 提供与宿主对应的 `.dsh/` 配置，UI 提供 `config/` 示例，不依赖仓库部署目录。`app/config/` 的地址、模型选择、权限和隧道配置仅用于特定部署。

复查：`node --test tests/plugin-independence.test.mjs`。测试将源码和包配置复制到独立临时目录，分别加载 tools、UI 和两者组合，检查服务端工具、客户端入口及插槽是否冲突。只提供声明的第三方依赖，不链接另一个插件。此验证不替代真实安装、浏览器和 GPU 验收。

从旧版本升级两包时，应同时更新已安装的 UI 包：旧 UI 客户端仍包含媒体卡片，新版只由 tools 注册。
