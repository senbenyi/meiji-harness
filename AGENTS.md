# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构

```text
.
├── harness/ — 本机 Harness 配置与 Agent presets
├── dsh-elysium-tools/ — 工具插件源码、工作流、构建脚本
├── runpod/ — 远端模型服务与生产脚本
├── tests/ — 部署与配置测试
└── docs/ — 设计、计划、实施及产品文档
```

## 执行铁律
- 职责分离：包、文件、类、方法简要说明职责

## 远程主机
- 检查服务： `~/.ssh/config`
- runpod服务器(ComfyUI)：`ssh veo-comfyui`
- autodl服务器(Qwen3.8)： `ssh veo-qwen38`
