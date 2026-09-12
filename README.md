# llm-dsh-plugins

DeepSeek Harness 插件、Agent 预设与部署脚本。

## 项目结构

```
dsh-elysium-tools/          工具插件：视频生成、媒体卡片、资产面板、分镜管理
harness/                    部署与运行时配置
  ├── .agent-presets/       四套 Agent 预设
  ├── config/               Harness 设置、启动与隧道配置
  ├── deploy.sh             服务器部署脚本（需要 root）
  ├── start.sh              启动/重启 Harness 服务
  └── qwen-tunnel.sh        Qwen 模型隧道
app/
  └── common/               本地部署、启动、配置解析脚本
tests/                      单元测试
```

## 插件

- **[dsh-elysium-tools](./dsh-elysium-tools/README.md)** — MiniMax H3 视频生成工具，提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及任务恢复。

## 下载、资产与分镜

视频卡片加载完成后，标题行可点击下载按钮。文件由本机服务流式代理，浏览器不必直连内网 ComfyUI；插件不落盘媒体文件。

右上角“资产面板”可展开或收起右侧栏，默认宽度为窗口的 10%（至少 180px），拖拽左边缘可调宽，面板状态随浏览器保存。资产页按最近完成时间列出成功任务，支持滚动加载和下载。

“分镜”页可新建、删除分镜，编辑标题、镜头名称、提示词和备注，关联任务 ID、设置状态，并上移、下移、替换或移除镜头。文字编辑失焦时保存；按钮操作立即保存。导演提示词直接维护在 `harness/.agent-presets/elysium-director/persona.md`。

接口、存储与验收说明见 [产品闭环修复实施记录](docs/implement/实施-产品闭环修复.md)。

## 预设模式

| 顺序 | ID | 名称 | 说明 |
|------|------|------|------|
| 1 | `elysium-teaching` | 极乐世界 · 教学 | 新手引导，逐步教学（**默认**） |
| 2 | `elysium-free` | 极乐世界 · 自由 | 全功能开放，最少确认 |
| 3 | `elysium-director` | 极乐世界 · 导演 | AI 短剧创作，剧本策划、分镜设计 |
| 4 | `elysium-standard` | 标准模式 | Harness 原生编码 Agent |

预设文件位于 `harness/.agent-presets/`，每个预设包含：

```
preset.yml            # 名称、描述、排序（order 字段，数字越小越靠前）
agent.cordis.yml      # 插件组合（cordis composition）
persona.md            # 人设提示词（elysium-* 独有）
rules.md              # 行为规则（elysium-* 独有）
skills/               # 可选技能目录；视频创作改用插件中文指令
```

teaching/free/director 的 `agent.cordis.yml` 均通过符号链接指向 `_base/agent.cordis.yml`，共享配置只需修改这一处。标准预设保持独立；默认不创建空 `skills/` 目录。部署 tools 时会一并复制 `_base`，已有配置保留。

## 部署

### 本地部署

```sh
# 部署工具插件（跳过 ComfyUI 检查）
SKIP_COMFYUI_CHECK=1 bash app/common/deploy_plugin.sh tools

# 启动/重启/停止 Harness
SKIP_COMFYUI_CHECK=1 bash app/common/start_harness.sh --restart
bash app/common/start_harness.sh --stop
```

### 服务器部署

```sh
sudo bash harness/deploy.sh
```

完整流程包括安装 Node.js/dsh/pnpm、注册插件、应用配置、复制预设、启动服务。

服务器部署时 `elysium-teaching` 的 `agent.cordis.yml` 会被 `harness/config/operator-agent.cordis.yml` 覆盖，仅保留 persona、skill-filesystem、tool-skill（禁用 bash/subagent 等危险工具）。

## Harness 配置

插件安装后需要两项配置才能正确显示 4 个预设并隐藏内置模式。部署脚本会自动应用，手动配置参考以下说明。

### cordis.patch.yml（插件级配置）

部署到 `$DSH_HOME/profiles/web/cordis.patch.yml`，仓库模板：`harness/config/profile.patch.yml`。

```yaml
- id: agent-presets
  config:
    default: elysium-teaching
    includeShippedRoot: false    # 隐藏内置预设（PTC、极简、创造）

- id: dsh-elysium-tools
  config:
    comfyUrl: http://127.0.0.1:8188
```

> `includeShippedRoot` 是插件级配置，**只在 `cordis.patch.yml` 中生效**，写在 `settings.yaml` 无效。

### settings.yaml（用户级设置）

运行配置位于 `$DSH_HOME/settings.yaml`。仓库统一配置源为 `harness/config/settings.yaml`，包含本机启动参数、隧道、模型和界面设置，默认权限为 `danger-full-access`。

仓库配置含模板占位符及 `harness-runtime`、`harness-customization`，不能直接复制为运行配置。使用 `python3 app/common/config_loader.py render` 生成运行配置（需要 PyYAML）；本机脚本通过同一解析器的 `shell` 模式读取启动参数。旧部署入口也使用此解析器，因此需保留仓库中 `app/common/config_loader.py` 的相对位置。

```yaml
agent-presets:
  default: elysium-teaching
```

## Remote Hosts

| Alias | 连接 | Role |
|---|---|---|
| `veo-comfyui` | `ssh veo-comfyui` | Image/video models, ComfyUI |
| `veo-qwen38` | `ssh veo-qwen38` | Qwen3.8 inference |

## 铁律

- 插件不允许上传、下载、保存文件方法
- 插件中媒体、视频、图片一律使用服务器 URL
- Harness 只在本机运行；远端服务器只保留模型服务

视频创作在 Harness 输入 `/`，依次选择 **预览创作、常规创作、高清创作**，填写创作内容后发送。菜单直接显示中文用途，详见 [三档指令与全链路](docs/implement/实施-视频创作三档入口与全链路.md)。
