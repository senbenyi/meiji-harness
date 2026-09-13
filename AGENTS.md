# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构

```text
.
├── app/ — 本机部署入口
│   ├── deploy_dsh_elysium_tools_local.sh — 部署 Elysium 工具插件
│   └── common/ — 部署脚本共享能力
│       ├── config_loader.sh — 读取 Harness 与远端服务配置
│       ├── deploy_plugin.sh — 安装和更新插件
│       ├── start_harness.sh — 启动本机 Harness
│       ├── check_comfyui.sh — 检查 ComfyUI 服务
│       └── start_tunnel_qwen.sh — 建立 Qwen 服务隧道
├── harness/
│   ├── config/
│   │   └── settings.yaml — 本机 Harness、远端模型服务地址与隧道设置
│   └── .agent-presets/ — Agent preset 配置
│       ├── _base/ — 公共 Agent 配置
│       ├── elysium-standard/ — 标准创作模式
│       ├── elysium-teaching/ — 教学引导模式
│       ├── elysium-free/ — 自由创作模式
│       └── elysium-director/ — 导演模式
├── dsh-elysium-tools/ — 工具注册、参数处理、任务调用与媒体卡片
│   ├── dsh.plugin.json — 插件清单与工具注册
│   ├── cordis.patch.yml — Harness 插件装配配置
│   ├── package.json — 构建、测试与打包命令
│   ├── scripts/
│   │   ├── build.mjs — 编译插件服务端与客户端代码
│   │   ├── package-registry.mjs — 组装 registry 包
│   │   ├── sync_runpod_video_workflows.mjs — 同步并编译 RunPod 视频工作流
│   │   └── preview-shot.mjs — 执行单镜头预览
│   ├── src/
│   │   ├── index.js — 服务端插件入口
│   │   ├── config.js — 插件运行配置
│   │   ├── client/ — Web 客户端、创作面板与媒体卡片
│   │   ├── functions/
│   │   │   ├── comfyui/ — ComfyUI 队列、状态、结果与取消工具
│   │   │   ├── jobs/ — 模型任务状态与结果工具
│   │   │   └── common/ — 工具参数、任务与诊断公共逻辑
│   │   ├── http/ — 项目与媒体任务 HTTP 接口
│   │   ├── jobs/ — 任务创建、提交、查询、等待与并发控制
│   │   ├── media/ — HTTP 媒体探测与 URL 处理
│   │   └── workflows/ — 图片和视频工作流编排
│   │       ├── profiles/ — preview、regular 等生成档位
│   │       └── templates/minimax-h3/ — MiniMax H3 五套 UI/API 图的唯一事实源
│   └── tests/ — 插件单元测试与集成测试
├── scripts/ — 仓库级短剧预览执行脚本
├── tests/ — Harness 配置、部署脚本与 preset 打包测试
└── docs/
    ├── design/ — 产品与交互设计
    ├── plans/ — 实施计划
    ├── implement/ — 实施记录与验收证据
    ├── research/ — 技术和产品调研
    └── products/ — 产品审查与冻结材料
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
