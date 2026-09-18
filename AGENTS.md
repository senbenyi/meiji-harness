# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构

```text
.
├── .claude/ — 调研、计划、实施与进度规范
├── harness/ — 本机 Harness 安装、启动与配置
│   ├── .dsh/ — 托管配置、Agent presets 与存储模板
│   ├── scripts/ — 安装、启动、隧道与存储模板脚本
│   └── tests/ — Harness 脚本、配置与预设测试
├── dsh-elysium/ — Elysium 创作插件
│   ├── src/ — 工具、HTTP 接口、创作工作台与任务管理源码
│   │   ├── business/ — 项目、导演、素材、任务、视频与多镜头生产业务
│   │   ├── harness/ — 仅存放注册给 Harness、可由 Agent 调用的工具定义
│   │   ├── utils/ — 配置、工具投影、项目解析与输出渲染等内部支持，不注册给 Harness
│   │   ├── servers/ — 按 registry/runtime/transport/providers 分包；平台专属内容集中在 providers/<id>/
│   │   └── comfyui/ — 公共 ComfyUI 协议；平台工作流位于各自 providers/<id>/workflows
│   ├── scripts/ — 构建、打包、工作流同步与生产入口
│   └── tests/ — 插件功能、工作台与视频生产测试
└── docs/ — 项目文档与验收资料
    ├── design/ — 设计文档
    ├── plans/ — 实施计划
    ├── implement/ — 实施记录、制作资料与验收产物
    ├── products/ — 产品资料与审查档案
    └── research/ — 调研与代码审查报告
```

## 执行铁律
- 职责分离：包、文件、类、方法简要说明职责

## 远程主机
- 检查服务： `~/.ssh/config`
- runpod服务器(ComfyUI)：`ssh veo-comfyui`
- autodl服务器(Qwen3.8)： `ssh veo-qwen38`
