# Harness 运行

## 配置文件

| 文件 | 用途 |
|---|---|
| [`app/config/harness-settings.yaml`](../app/config/harness-settings.yaml) | 运行参数、模型、UI、Agent preset |
| [`presets/elysium/persona.md`](../dsh-elysium-tools/presets/elysium/persona.md) | 随包提供的 Elysium 人格 |
| [`presets/elysium/instructions.md`](../dsh-elysium-tools/presets/elysium/instructions.md) | Elysium 会话协作指令 |
| [`presets/elysium/skills/`](../dsh-elysium-tools/presets/elysium/skills) | 随包提供的创作技能 |
| [`app/common/config_loader.py`](../app/common/config_loader.py) | 配置解析与应用 |

服务器部署目录：`/root/autodl-tmp/project/harness`。
远端 `127.0.0.1:3080`；本地隧道 `127.0.0.1:23080`。

## 服务管理

```bash
bash app/common/start_harness.sh            # 启动
bash app/common/start_harness.sh --restart   # 重启
bash app/common/start_harness.sh --stop      # 停止
```

启动时检查 Qwen API，必要时通过 `QWEN_SSH_TARGET` 指定的 SSH 别名建立隧道；别名由执行机器的 `~/.ssh/config` 管理，使用服务器现有密钥和 `BatchMode=yes`。项目不再分发 SSH 配置。

Harness 服务器须能直接执行 `ssh -o BatchMode=yes veo-qwen38 true`；Mac 的别名配置不会自动同步到服务器。部署目标同样读取 `HARNESS_SSH_TARGET`，由本机系统 SSH 配置解析。

Qwen 隧道脚本重复执行会复用健康通道；重建前先验证 SSH 和远端模型 API，预检失败时保留旧通道。

## 部署

从仓库根目录分别发布工具和 UI 插件：

```bash
bash app/deploy_dsh_elysium_tools.sh
bash app/deploy_dsh_elysium_ui.sh
```

流程：检查远端环境 → 本地安装、测试、构建、打包 → 镜像同步 `app/`（含 `app/config/`）和插件产物（含 preset 与技能） → 服务器安装、注册、覆盖配置、重启 → 本机建隧道并检查。

镜像同步删除远端已移除文件，保留 `node_modules`。声明生产依赖的插件须携带 `pnpm-lock.yaml`；服务器用 pnpm 按锁文件安装并禁用生命周期脚本。依赖安装或模块加载失败时不继续注册和重启。

发布后刷新页面验收任务卡、视频播放与下载；HTTP 检查不替代浏览器验收。

本机需要：Git、pnpm、rsync、SSH、curl、lsof、Python 3 + PyYAML。可通过 `PYTHON_BIN` 指定 Python 路径。

恢复本地隧道：`bash app/open_tunnel_harness.sh`。脚本分别检查、建立或复用 Harness 和 ComfyUI 通道；已有 `23080` 通道不会跳过 `6016` 检查。

SSH 目标与端口读取 `app/config/harness-settings.yaml` 的 `harness-runtime`，入口不接受参数。Harness 使用 `HARNESS_LOCAL_PORT` → `HARNESS_WEB_PORT`；ComfyUI 从 `MINIMAX_H3_COMFYUI_PUBLIC_URL` 与 `MINIMAX_H3_COMFYUI_URL` 读取转发地址。浏览器地址为回环地址时建立 SSH 通道，其他地址只检查可访问性。配置解析需要 PyYAML，可通过 `PYTHON_BIN` 指定已有 Python 环境。

## 极乐世界预设

从 `standard/agent.cordis.yml` 生成自定义预设，完整保留文件、Shell、检索、计划、目标、子代理等通用能力。仅覆盖身份和技能目录。

### 技能分流

- **creation-video**：一次生成完成、无需合成，通常 ≤15s
- **creation-drama**：多段生成后合成，通常 >15s

以是否需要合成为准；常驻指令只负责分流，制作细节按需加载。

### 导演

经 UI 插件的 `system-prompt/assemble` 接入会话，每次只输出 ID、名称和版本哈希。用户选定后调用 `elysium_read_director` 按 ID 取最新正文；相同版本复用，变化时重新读取。导演管理在普通预设中也可独立使用；部署时保留已安装 UI 插件的导演设置，除非部署配置显式覆盖该字段。

### 视频生产

统一使用 `workflow_generate_video`，注册创建、恢复、状态查询、结果获取四个工具。多镜头用 `shots` 绑定每镜参数；独立生成、参考生成、末帧续拍和 reuse 可组合。失败用 `workflow_resume_video` 复用原任务；人工改稿新建任务。

H3 原生 24 fps 生成，交付 480×854、30 fps、H.264。工具包自带媒体任务卡，不需额外安装 UI 或图片预览插件。成片在任务卡直接播放；优先通过 ComfyUI 视频地址播放，加载失败自动回退到 Harness 同源媒体接口；两者均失败时显示重试。会话中断后仍按原会话与调用 ID 查询后台任务，不重新生成。

验收：正常连接时检查 ComfyUI「资产」内的成片与 Harness 视频卡；仅让浏览器无法访问 ComfyUI 时，视频卡应改用 Harness 媒体接口播放；重新打开中断会话，已完成任务应恢复成片。ComfyUI 当前资产列表按任务分组，封面可能为 `shot-1`，展开后查看 `final`。

### 上下文成本

默认媒体插件提供四个生产工具和一个加载工具。通用工具不因 token 优化而禁用；文件、Shell、规划、子代理、编排五组延迟加载。任务结果默认渲染紧凑摘要；`detail: true` 保留完整诊断。

## 配置验证

```bash
python3 -m unittest discover -s tests -p 'test_harness_settings.py'
```

检查远端服务与工具清单：

```bash
ssh veo-comfyui 'curl -fsS http://127.0.0.1:3080/ >/dev/null'
ssh veo-comfyui 'jq .contributes.tools /root/autodl-tmp/wan22-harness/home/profiles/web/node_modules/@dsh-external/dsh-elysium-tools/dsh.plugin.json'
```
