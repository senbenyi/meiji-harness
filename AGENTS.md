# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构

```text
.
├── app/ — 本机 Harness 与插件部署脚本
├── harness/ — 本机 Harness 配置与 Agent presets
├── dsh-elysium-tools/ — 工具插件源码、工作流、构建脚本
├── scripts/ — 仓库级执行脚本
├── tests/ — 部署与配置测试
└── docs/ — 设计、计划、实施及产品文档
```

## 执行铁律
- 插件不允许上传、下载、保存文件方法
- 插件中媒体、视频、图片一律使用服务器url
- Harness 只在本机运行；远端服务器只保留模型服务。

## 执行命令
- `pnpm install --frozen-lockfile --ignore-scripts`
- `pnpm test`
- `pnpm build`
- `pnpm package:registry`


## 远程主机
- 检查服务： `~/.ssh/config`
- runpod服务器(ComfyUI / harness)：`ssh veo-comfyui`
- autodl服务器(Qwen3.8)： `ssh veo-qwen38`
