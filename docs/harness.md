# Harness 运行

- 配置：[`config/harness-settings.yaml`](../config/harness-settings.yaml)。
- 系统提示词：[`config/system-prompt.yaml`](../config/system-prompt.yaml)。
- 对话指令：[`config/harness-agent.md`](../config/harness-agent.md)。
- 解析器：[`scripts/common/config_loader.py`](../scripts/common/config_loader.py)。
- 技能：[.dsh/skills](../.dsh/skills)，随项目部署。
- 服务器部署与对话工作目录：`/root/autodl-tmp/project/harness`。
- 服务：远端 `127.0.0.1:3080`；本地隧道 `127.0.0.1:23080`。

部署要求服务器已安装 Harness；本项目独立同步配置、启动脚本和技能。
安装目录、部署目录、对话工作目录与共享输入目录均读取 `harness-runtime`。

在服务器脚本目录执行：

```bash
bash scripts/common/start_harness.sh
bash scripts/common/start_harness.sh --restart
bash scripts/common/start_harness.sh --stop
```

启动时自动检查 Qwen API，必要时通过 `config/ssh_config` 中的 `veo-qwen38` 别名建立通道；使用服务器现有密钥和 `BatchMode=yes`，认证失败直接报错。

从本仓库根目录分别发布工具和 UI 插件（媒体任务卡需要两者）：

```bash
bash scripts/deploy_dsh_elysium_tools.sh
bash scripts/deploy_dsh_elysium_ui.sh
```

两个入口共用 `scripts/common/deploy_plugin.sh`：先检查远端环境，完成本地依赖安装、测试、构建和打包，成功后再上传 `.dsh/`、`config/`、`scripts/` 与对应插件产物。镜像同步会删除目标目录中本地已移除的文件，但保留远端插件的 `node_modules`。
随后自动调用服务器的 `scripts/common/install_plugin.sh tools|ui`，校验产物及依赖、注册插件、覆盖配置、重启和检查。每个入口单独发布一个插件并重启一次。声明了生产依赖的插件必须携带 `pnpm-lock.yaml`，服务器使用 pnpm 按锁文件安装生产依赖并禁用生命周期脚本，因此需要访问锁文件中的包下载地址。UI 不依赖宿主传递依赖的目录布局，也不上传 macOS 的 `node_modules`；旧版宿主依赖链接会被移除，仅删除链接本身。依赖安装或模块加载失败时不会继续注册和重启。
最后在本机建立访问隧道，并检查 `http://127.0.0.1:23080/`。

本机需要 Git、pnpm、rsync、SSH、curl、lsof 和安装了 PyYAML 的 Python；默认 `python3`，可通过 `PYTHON_BIN` 指定，例如 `PYTHON_BIN=/opt/miniconda3/bin/python3.13 bash scripts/deploy_dsh_elysium_ui.sh`。HTTP 检查不替代浏览器验收：发布后刷新页面，检查任务卡、视频播放与下载。只需本机实例时使用 [UI 本机部署](../dsh-elysium-ui/README.md#本机部署)。

远端生产依赖安装使用直连，仅在安装子进程内清除代理环境并设置 `NO_PROXY=*`，避免继承失效的 `127.0.0.1:7890` 代理；不修改服务器全局代理或 Harness 运行环境。

UI 包声明 `dsh.client` 时必须通过 `exports["./client"]` 导出浏览器入口，同时保留服务端根入口和 `./package.json` 导出供 Harness 解析。缺少客户端导出会导致整个 Harness 启动失败；部署前的 UI 测试覆盖这三个入口的解析。

启动前备份并覆盖设置、profile、Agent preset 和项目指令，保留会话与项目数据。
启动时将 `harness-agent.md` 写入 Harness 固定入口 `$DSH_HOME/AGENTS.md`；项目指令发现沿用标准模式。
新对话加载 Elysium preset 和上述指令；已有对话不自动切换 preset。

### 极乐世界预设

从服务器已安装版本的 `standard/agent.cordis.yml` 生成极乐世界自定义预设，完整保留文件、Shell、检索、计划、目标、子代理、通用工作流及上下文管理。仅覆盖身份和技能目录；通用任务与媒体生产均在极乐世界中完成，无需切换预设。

`harness-customization.agent.metadata` 生成 `$DSH_HOME/.agent-presets/elysium/preset.yml`，设置页显示“极乐世界”及短剧能力描述，预设 ID 仍为 `elysium`。生成器同时校验名称和描述，写入前生成全部配置，原文件保存为 `.previous`。

仅复杂创作加载 `elysium-shot-design`；媒体生产直接按工具参数提交、复用和续做，无独立生产 Skill。已授权制作不在创作阶段停下，咨询也不会直接触发生成。默认交付原片，声音、插帧和超分按需求追加；对白音频不代表已混音或对口型，未查看媒体不标记人工验收通过。

本地配置回归：`python3 -m unittest discover -s tests -p 'test_harness_settings.py'`。发布后需核对设置页名称与描述、新会话通用工具及媒体工具清单、技能发现；生成链路另做授权验收。
服务器重启后，可在本仓库单独恢复本地通道：`bash scripts/common/start_tunnel_harness.sh`。
本地端口读取 `harness-runtime.HARNESS_LOCAL_PORT`，默认 `23080`。

视频生产统一使用 `workflow_generate_video`。默认注册创建、恢复、状态查询、结果获取四个工具；服务端 `ELYSIUM_ENABLE_ATOMIC_TOOLS=1` 仅用于原子能力测试。原子失败不能作为生产工作流的降级路径。

工作流由独立进程执行，工具在程序内等待终态并返回结果，新生成使用目标总时长与分镜，已有素材使用有序 MP4 路径；由服务端生成或复用、合片并验证后返回 `final.mp4`。失败用 `workflow_resume_video` 复用原任务步骤。第一版保留原音轨和规格，不自动追加后期处理。参数见 [工具说明](../dsh-elysium-tools/README.md)。

发布须同步模型脚本、插件、配置及 `.dsh/skills`，并在新会话核对生产工具注册。不照搬作者桌面工作流的25步和720p配置。

检查服务与实际安装的工具清单：

```bash
ssh veo-comfyui 'curl -fsS http://127.0.0.1:3080/ >/dev/null'
ssh veo-comfyui 'jq .contributes.tools /root/autodl-tmp/wan22-harness/home/profiles/web/node_modules/@dsh-external/dsh-elysium-tools/dsh.plugin.json'
```

撤销插件变更时，使用已知可用版本重新发布，分别验证 Harness 与 ComfyUI；不删除模型。

### 上下文成本

采用 [OpenAI function calling 建议](https://developers.openai.com/api/docs/guides/function-calling)：减少首轮工具、保留简洁明确的参数、将固定流程交给代码。当前 Qwen 的 Chat Completions 路由不添加 Responses 专用 `tool_search` / `defer_loading` 字段；本版通过原生 `system-prompt/assemble` 扩展点和 `elysium_load_tools` 普通函数实现按组加载，不修改上游 Harness。

极乐世界继承的通用工具不因 token 优化而禁用；默认媒体插件提供四个生产工具和一个加载工具。文件、Shell、规划、子代理、通用编排五组的定义与对应工具说明延迟加载；模型可见简短目录，其他未知工具及所有权限/计划策略保留。以成功的加载工具结果重建已加载列表，恢复会话后继续可用，组内权限受限或已移除工具不会重新开放。Code Mode 和其他预设保持原协议。部署后以新会话 request/header 核对工具与上下文。

任务结果默认渲染紧凑摘要，不重复请求输入或整条诊断链；状态/结果工具的 `detail: true` 保留完整诊断。原始状态文件与产物不裁剪。发布后用同一短视频请求比较首轮输入、未缓存输入、cacheReadTokens、输出与模型调用轮数；字符统计只能衡量上下文体积，不能代替模型 tokenizer 或实测 token。缓存读取与未缓存输入分开报告。

生成和恢复工具等待终态再交给模型，等待发生在程序中，不增加模型请求。停止等待不会杀掉独立生产进程；按错误中的 job_id 查询原任务。关闭会话后自动推送通知尚未接入，此时需要用户恢复会话查询。缓存前缀可能在首次加载工具组时变化；本会话不反复卸载已加载工具，实际延迟和 token 收益仍须同模型 A/B 验证。

### 对话内媒体任务卡

`dsh-elysium-ui` 通过原生 `tool.call.toolview` 插槽展示视频创建/恢复任务，保留导演设置。工具插件持久化调用关联并提供带页面凭据的只读状态/视频流接口；UI 定时查询不经过模型，不增加 token。播放器使用同源路径，避免服务器端口与本地隧道端口不一致。需要工具插件和 UI 插件一起发布，旧 UI 单独更新模型脚本不会得到任务卡。

刷新后按会话和工具调用 ID 恢复后台状态；失败不自动重跑，完成可直接播放和下载。详细模块边界、兼容和验收见 [UI 插件说明](../dsh-elysium-ui/README.md#模块边界)。
