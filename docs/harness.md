# Harness 运行

## 配置文件

| 文件 | 用途 |
|---|---|
| [`config/harness-settings.yaml`](../config/harness-settings.yaml) | 运行参数、模型、UI、Agent preset |
| [`config/system-prompt.yaml`](../config/system-prompt.yaml) | 系统提示词 persona |
| [`config/harness-agent.md`](../config/harness-agent.md) | 对话指令 |
| [`config/ssh_config`](../config/ssh_config) | Qwen 服务器 SSH 配置 |
| [`.dsh/skills/`](../.dsh/skills) | 按需加载的创作技能 |
| [`scripts/common/config_loader.py`](../scripts/common/config_loader.py) | 配置解析与应用 |

服务器部署目录：`/root/autodl-tmp/project/harness`。
远端 `127.0.0.1:3080`；本地隧道 `127.0.0.1:23080`。

## 服务管理

```bash
bash scripts/common/start_harness.sh            # 启动
bash scripts/common/start_harness.sh --restart   # 重启
bash scripts/common/start_harness.sh --stop      # 停止
```

启动时检查 Qwen API，必要时通过 `config/ssh_config` 建立隧道；使用服务器现有密钥和 `BatchMode=yes`。

Qwen 隧道脚本重复执行会复用健康通道；重建前先验证 SSH 和远端模型 API，预检失败时保留旧通道。

## 部署

从仓库根目录分别发布工具和 UI 插件：

```bash
bash scripts/deploy_dsh_elysium_tools.sh
bash scripts/deploy_dsh_elysium_ui.sh
```

流程：检查远端环境 → 本地安装、测试、构建、打包 → 镜像同步 `.dsh/`、`config/`、`scripts/` 和插件产物 → 服务器安装、注册、覆盖配置、重启 → 本机建隧道并检查。

镜像同步删除远端已移除文件，保留 `node_modules`。声明生产依赖的插件须携带 `pnpm-lock.yaml`；服务器用 pnpm 按锁文件安装并禁用生命周期脚本。依赖安装或模块加载失败时不继续注册和重启。

发布后刷新页面验收任务卡、视频播放与下载；HTTP 检查不替代浏览器验收。

本机需要：Git、pnpm、rsync、SSH、curl、lsof、Python 3 + PyYAML。可通过 `PYTHON_BIN` 指定 Python 路径。

恢复本地隧道：`bash scripts/common/start_tunnel_harness.sh`，端口读取 `harness-runtime.HARNESS_LOCAL_PORT`。

独立隧道入口：`bash scripts/start_tunnel_harness.sh [SSH目标]`（从 `llm-ai-brain/app/` 迁入），默认连接 `veo-comfyui`，映射本地 `23080` 到远端 `3080`；可用 `WAN22_HARNESS_LOCAL_PORT`、`WAN22_HARNESS_PORT` 覆盖端口。

## 极乐世界预设

从 `standard/agent.cordis.yml` 生成自定义预设，完整保留文件、Shell、检索、计划、目标、子代理等通用能力。仅覆盖身份和技能目录。

### 技能分流

- **creation-video**：一次生成完成、无需合成，通常 ≤15s
- **creation-drama**：多段生成后合成，通常 >15s

以是否需要合成为准；常驻指令只负责分流，制作细节按需加载。

### 导演

经 UI 插件的 `system-prompt/assemble` 接入会话，每次只输出 ID、名称和版本哈希。用户选定后调用 `elysium_read_director` 按 ID 取最新正文；相同版本复用，变化时重新读取。部署配置完整覆盖前，须将需保留的导演同步到 `config/harness-settings.yaml`。

### 视频生产

统一使用 `workflow_generate_video`，注册创建、恢复、状态查询、结果获取四个工具。多镜头用 `shots` 绑定每镜参数；独立生成、参考生成、末帧续拍和 reuse 可组合。失败用 `workflow_resume_video` 复用原任务；人工改稿新建任务。

H3 原生 24 fps 生成，交付 480×854、30 fps、H.264。成片在任务卡直接播放；播放地址使用 ComfyUI `/api/view`。

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
