# dsh-elysium-tools

Harness RunPod MiniMax H3 视频生成插件，自带任务卡和四套 Agent 预设。仅提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及原任务恢复。

## 预设模式

| 顺序 | ID | 名称 | 说明 |
|------|------|------|------|
| 1 | `elysium-teaching` | 极乐世界 · 教学 | 新手引导，逐步教学视频创作流程（**默认**） |
| 2 | `elysium-free` | 极乐世界 · 自由 | 任意提示词生成视频，全功能开放，最少确认 |
| 3 | `elysium-director` | 极乐世界 · 导演 | AI 成人短剧创作，剧本策划、分镜设计、连续剧集 |
| 4 | `standard` | 标准模式 | Harness 原生标准编码 Agent（从内置复制） |

预设文件位于 `.dsh/.agent-presets/`，每个预设包含：

```
preset.yml            # 名称、描述、排序
agent.cordis.yml      # 插件组合（cordis composition）
persona.md            # 人设提示词（elysium-* 独有）
rules.md              # 行为规则（elysium-* 独有）
skills/               # 技能文档（elysium-* 独有）
```

排序通过 `preset.yml` 中的 `order` 字段控制，数字越小越靠前。

## 1. 构建与安装插件

需要 Harness、Node.js 20.16+、Python 3，以及已提供五份 MiniMax H3 工作流的 RunPod ComfyUI。本项目不下载、安装或检查模型文件。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

或使用自动化脚本一键完成构建、注册和重启：

```sh
# 本地部署（跳过 ComfyUI 检查）
SKIP_COMFYUI_CHECK=1 bash app/common/deploy_plugin.sh tools

# 远程服务器部署（完整检查）
bash app/common/deploy_plugin.sh tools
```

## 2. 配置 Harness

插件安装后需要两项配置才能正确显示 4 个预设并隐藏内置的 PTC、极简、创造模式。

### 2.1 profile.patch.yml

此文件控制插件级配置，部署到 `$DSH_HOME/profiles/web/cordis.patch.yml`。
仓库模板：`harness/config/profile.patch.yml`。

必须包含：

```yaml
# 隐藏内置预设（PTC、极简、创造），只显示我们的 4 个
- id: agent-presets
  config:
    default: elysium-teaching
    includeShippedRoot: false

# ComfyUI 地址（按实际部署修改）
- id: dsh-elysium-tools
  config:
    comfyUrl: http://127.0.0.1:8188
```

**关键说明**：`includeShippedRoot` 和 `default` 是插件级配置，必须写在 `cordis.patch.yml` 中，写在 `settings.yaml` 中无效。

### 2.2 settings.yaml

此文件控制用户级设置，位于 `$DSH_HOME/settings.yaml`。
仓库模板：`harness/config/settings.yaml`。

需要包含：

```yaml
agent-presets:
  default: elysium-teaching
  includeShippedRoot: false
```

### 2.3 复制预设目录

部署脚本会自动将预设复制到 `$DSH_HOME/.agent-presets/`。如需手动复制：

```sh
for preset in standard elysium-teaching elysium-free elysium-director; do
  cp -R dsh-elysium-tools/.dsh/.agent-presets/$preset ~/.dsh/.agent-presets/
done
```

**注意**：部署脚本使用 `if [[ ! -e ... ]]` 跳过已存在的预设。如需更新已部署的预设内容（如修改了 `preset.yml` 的排序），需要先删除目标目录再重新复制。

## 3. 同步 RunPod 工作流

`src/workflows/templates/minimax-h3/` 是五套 MiniMax H3 UI/API 图及 Harness 绑定的唯一事实源。同步和只读核验命令：

```sh
pnpm workflow:sync
pnpm workflow:check
python3 -m unittest tests/test_runpod_workflow_sync.py
```

同步器从已配置的 RunPod ComfyUI 读取五套 UI 图，编译 API 图并更新源 SHA-256；这些命令不提交 GPU 任务。

## 4. 本地开发

```sh
# 跳过 ComfyUI 检查启动/重启 Harness
SKIP_COMFYUI_CHECK=1 bash app/common/start_harness.sh --restart

# 停止 Harness
bash app/common/start_harness.sh --stop
```

## 5. 服务器部署

使用 `harness/deploy.sh`（需要 root），完整流程包括：
- 安装 Node.js、dsh、pnpm
- 注册插件到 web profile
- 应用 `harness/config/profile.patch.yml` 和 `harness/config/settings.yaml`
- 复制预设到 `$HOME_ROOT/.agent-presets/`
- 用运维版 `operator-agent.cordis.yml` 替换教学预设的 composition（禁用 bash/subagent 等危险工具）
- 启动 Harness 服务

```sh
sudo bash harness/deploy.sh
```

**本地 vs 服务器差异**：服务器部署时，`elysium-teaching` 的 `agent.cordis.yml` 会被 `harness/config/operator-agent.cordis.yml` 覆盖，仅保留 persona、skill-filesystem、tool-skill 三个插件。本地开发使用源码中的完整 composition。
