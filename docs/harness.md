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

从本仓库根目录发布工具插件：

```bash
bash scripts/deploy_dsh_elysium_tools.sh
```

先上传 `.dsh/`、`config/`、`scripts/`，再本地构建并上传产物。
随后进入服务器部署目录，执行 `scripts/common/install_dsh_elysium_tools.sh`，完成注册、配置覆盖、重启和检查。
最后在本机建立访问隧道，并检查 `http://127.0.0.1:23080/`。

启动前备份并覆盖设置、profile、Agent preset 和项目指令，保留会话与项目数据。
启动时将 `harness-agent.md` 写入 Harness 固定入口 `$DSH_HOME/AGENTS.md`；项目指令发现沿用标准模式。
新对话加载 Elysium preset 和上述指令；已有对话不自动切换 preset。

### 极乐世界预设

从服务器已安装版本的 `standard/agent.cordis.yml` 生成，保留标准模式的文件、Shell、检索、计划、目标、子代理、工作流及上下文管理配置。只覆盖 persona 与技能目录；通用工具以实际安装和会话权限为准。

`harness-customization.agent.metadata` 生成 `$DSH_HOME/.agent-presets/elysium/preset.yml`，设置页显示“极乐世界”及短剧能力描述，预设 ID 仍为 `elysium`。生成器同时校验名称和描述，写入前生成全部配置，原文件保存为 `.previous`。

创作由 `elysium-shot-design` 组织故事、角色、对白和分镜；制作由 `elysium-media-task` 组合现有媒体工具，复用素材并按任务 ID 续做。已授权制作不在创作阶段停下，咨询也不会直接触发生成。默认交付原片，声音、插帧和超分按需求追加；对白音频不代表已混音或对口型，未查看媒体不标记人工验收通过。

本地配置回归：`python3 -m unittest discover -s tests -p 'test_harness_settings.py'`。发布后需核对设置页名称与描述、新会话标准工具及媒体工具清单、技能发现；生成链路另做授权验收。
服务器重启后，可在本仓库单独恢复本地通道：`bash scripts/common/start_tunnel_harness.sh`。
本地端口读取 `harness-runtime.HARNESS_LOCAL_PORT`，默认 `23080`。

视频工具：`model_generate_video`，`mode` 为 `text`（文字生成视频）、`image`（图片生成视频）、`reference`（参考素材生成视频）。执行模型由路由配置决定。

短视频 `duration` 为 1..15 秒；长视频 `model_generate_video_long` 的 `duration` 为超过 15 秒的总时长。当前默认 MiniMax H3，60 秒建议 12 段×5 秒，默认竖版档位为 `long_vertical_preview`。具体参数见 [工具说明](../dsh-elysium-tools/README.md)。

插件通过 `PROJECT_ID` 对齐模型输出目录，不能把公共 `project-id` 目录中的图片当作本次产物。部署此版本须同步模型脚本、插件和 `.dsh/skills`，否则总时长参数与旧执行器不匹配。Qwen 当前声明仅支持文本，不能靠修改工具说明获得视觉验收能力。

检查服务与实际安装的工具清单：

```bash
ssh veo-comfyui 'curl -fsS http://127.0.0.1:3080/ >/dev/null'
ssh veo-comfyui 'jq .contributes.tools /root/autodl-tmp/wan22-harness/home/profiles/web/node_modules/@dsh-external/dsh-elysium-tools/dsh.plugin.json'
```

撤销插件变更时，使用已知可用版本重新发布，分别验证 Harness 与 ComfyUI；不删除模型。
