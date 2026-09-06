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

启动前备份并覆盖设置、profile、Agent preset 和项目指令，保留会话与项目数据。
启动时将 `harness-agent.md` 写入 Harness 固定入口 `$DSH_HOME/AGENTS.md`；关闭工作目录指令扫描。
新对话加载 Elysium preset 和上述指令；已有对话不自动切换 preset。
本地联合隧道使用 `../llm-ai-brain/app/start_tunnel_harness_comfyui.sh`。

视频工具：`model_generate_video`，`mode` 为 `text`（文字生成视频）、`image`（图片生成视频）、`reference`（参考素材生成视频）。执行模型由路由配置决定。

检查服务与实际安装的工具清单：

```bash
ssh veo-comfyui 'curl -fsS http://127.0.0.1:3080/ >/dev/null'
ssh veo-comfyui 'jq .contributes.tools /root/autodl-tmp/wan22-harness/home/profiles/web/node_modules/@dsh-external/dsh-elysium-tools/dsh.plugin.json'
```

撤销插件变更时，使用已知可用版本重新发布，分别验证 Harness 与 ComfyUI；不删除模型。
