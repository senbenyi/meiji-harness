# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构

```text
├── app — 部署入口
│   └── common — 配置解析、安装、启动和隧道脚本
├── harness/
│   ├── config/ — 本机 Harness、远端模型服务地址与隧道设置
│   └── .agent-presets/ — 四套 Agent preset（elysium-standard 标准、elysium-teaching 教学、elysium-free 自由、elysium-director 导演），含人格、协作指令和创作技能
├── dsh-elysium-tools/ — 工具注册、参数处理、任务调用与媒体卡片
│   ├── src/workflows/templates/minimax-h3/ — MiniMax H3 五套 UI/API 图及绑定的唯一事实源
│   └── scripts/sync_runpod_video_workflows.mjs — 从 RunPod 同步并编译五套工作流
```

## 铁律
- 插件不允许上传、下载、保存文件方法
- 插件中媒体、视频、图片一律使用服务器url
- Harness 只在本机运行；远端服务器只保留模型服务。

## 构建、开发命令
- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖。
- `pnpm test`：运行当前插件的测试。
- `pnpm build`：生成可分发的构建产物。
- `pnpm package:registry`：组装 registry 包。


## Remote Hosts

| Alias | 连接 | Role |
|---|---|---|
| `veo-comfyui` | `ssh veo-comfyui` | Image/video models, ComfyUI |
| `veo-qwen38` | `ssh veo-qwen38` | Qwen3.8 inference |

更换服务先检查 `~/.ssh/config`。
