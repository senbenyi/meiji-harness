# Harness 运行

## 配置文件

| 文件 | 用途 |
|---|---|
| [`app/config/harness-settings.yaml`](../app/config/harness-settings.yaml) | 运行参数、模型、UI、Agent preset |
| [`.dsh/.agent-presets/elysium/persona.md`](../dsh-elysium-tools/.dsh/.agent-presets/elysium/persona.md) | 随包提供的 Elysium 人格 |
| [`.dsh/.agent-presets/elysium/rules.md`](../dsh-elysium-tools/.dsh/.agent-presets/elysium/rules.md) | Elysium 会话协作指令 |
| [`.dsh/.agent-presets/elysium/skills/`](../dsh-elysium-tools/.dsh/.agent-presets/elysium/skills) | 随包提供的创作技能 |
| [`app/common/config_loader.py`](../app/common/config_loader.py) | 本机运行与模型隧道配置解析 |

Harness 只在本机运行：`http://127.0.0.1:3080/`。远端服务器不再安装或启动 Harness。

## 服务管理

```bash
bash app/common/start_harness.sh            # 启动
bash app/common/start_harness.sh --restart   # 重启
bash app/common/start_harness.sh --stop      # 停止
```

启动时检查 Qwen API 与 ComfyUI，必要时通过本机 `~/.ssh/config` 的 `veo-qwen38` 和 `veo-comfyui` 别名建立隧道。项目不分发 SSH 配置。

Qwen 隧道脚本重复执行会复用健康通道；重建前先验证 SSH 和远端模型 API，预检失败时保留旧通道。

## 模型服务隧道

恢复 ComfyUI：`bash app/open_tunnel_comfyui.sh`。Qwen 隧道由本机 Harness 启动脚本检查和恢复。Harness 本身不使用 SSH 隧道。

SSH 目标与端口读取 `app/config/harness-settings.yaml`。ComfyUI 使用本机 `6016`，Qwen API 使用本机 `18000`。配置解析需要 PyYAML，可通过 `PYTHON_BIN` 指定本机 Python。

## 本机安装

```bash
bash app/deploy_dsh_elysium_tools_local.sh
bash app/deploy_dsh_elysium_ui_local.sh
```

两个入口均在本机测试、构建、打包、注册 web profile，随后重启本机 Harness；不会向远端同步插件或 Harness 配置。

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

H3 原生 24 fps 生成，交付 480×854、30 fps、H.264。工具包自带媒体任务卡。成片通过 ComfyUI HTTP 地址播放；会话中断后仍按原会话与调用 ID 查询本机任务状态，不重新生成。

验收：正常连接时检查 ComfyUI「资产」内的成片与 Harness 视频卡；浏览器无法访问 ComfyUI 时应明确显示预览失败，不创建本地媒体副本；重新打开中断会话，已完成任务应恢复 HTTP 地址。ComfyUI 当前资产列表按任务分组，封面可能为 `shot-1`，展开后查看 `final`。

### 上下文成本

默认媒体插件提供四个生产工具和一个加载工具。通用工具不因 token 优化而禁用；文件、Shell、规划、子代理、编排五组延迟加载。任务结果默认渲染紧凑摘要；`detail: true` 保留完整诊断。

## 配置验证

```bash
python3 -m unittest discover -s tests -p 'test_harness_settings.py'
```

检查本机服务与工具清单：

```bash
curl -fsS http://127.0.0.1:3080/ >/dev/null
jq .contributes.tools ~/.dsh/profiles/web/node_modules/@dsh-external/dsh-elysium-tools/dsh.plugin.json
```
