# llm-dsh-plugins

DeepSeek Harness 插件、Agent 预设与部署脚本。

## 项目结构

```
dsh-elysium-tools/          工具插件：视频生成、媒体卡片、素材管理、项目管理
harness/                    本机运行配置
  ├── .agent-presets/       四套 Agent 预设
  └── config/               Harness 设置与模型服务配置
app/
  └── common/               本地部署、启动、配置解析脚本
tests/                      单元测试
```

## 插件

- **[dsh-elysium-tools](./dsh-elysium-tools/README.md)** — MiniMax H3 视频生成工具，提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及任务恢复。

## 下载、素材与项目

视频卡片加载完成后，标题行可点击下载按钮。文件由本机服务流式代理，浏览器不必直连内网 ComfyUI；插件不落盘媒体文件。

右上角“创作工作台”打开全屏制作界面，“返回聊天”保留当前项目与工作位置。素材使用分页网格，支持全库关键词搜索、档次/类型筛选、按需预览、下载和确认后引入项目锚点。视频卡片没有封面时显示占位，不同时加载大量播放器。

三层资产结构为素材（公共池）→ 项目（结构化制作）→ 交付（成片与字幕）。项目包含锚点、分镜、交付三个页面。分镜使用幕导航、每页 30 镜列表和单镜详情，可按镜号、动作、字幕搜索及角色/状态筛选。字段编辑采用明确的保存/取消，失败保留草稿；“标记待重拍”保留旧产物，“解除素材关联”清空任务关联并恢复待生成。窄屏点击镜头进入详情，返回时保留位置。

交付物通过项目更新 API 登记任务 ID 或服务器 URL，交付页提供单成片预览、规格、字幕文件与下载链接；任务文件复用媒体代理，服务器 URL 由浏览器直接访问。当前阶段不自动生成、绑定任务或拼接成片；素材引入仅增加引用，原素材保留，公共列表仍展示成功任务。导演提示词仍在 `harness/.agent-presets/elysium-director/persona.md` 维护。

接口、存储与验收说明见 [产品闭环修复实施记录](docs/implement/实施-产品闭环修复.md)。

本次创作工作台改造尚未部署，线上仍为此前版本；验收覆盖与待验项见 [实施记录](docs/implement/实施-创作工作台体验优化.md)。

Harness 只在本机运行；远端主机仅提供 ComfyUI 和 Qwen 模型服务。

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

## Harness 配置

插件安装后需要两项配置才能正确显示 4 个预设并隐藏内置模式。部署脚本会自动应用，手动配置参考以下说明。

### settings.yaml（用户级设置）

运行配置位于 `$DSH_HOME/settings.yaml`。仓库统一配置源为 `harness/config/settings.yaml`，包含本机启动参数、隧道、模型和界面设置，默认权限为 `danger-full-access`。

仓库配置含模板占位符及 `harness-runtime`、`harness-customization`，不能直接复制为运行配置。使用 `bash app/common/config_loader.sh render` 生成运行配置；本机脚本通过同一解析器的 `shell` 模式读取启动参数。

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
