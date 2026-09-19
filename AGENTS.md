# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 执行铁律
- 职责分离：包、文件、类、方法名称 简要说明职责
- 存贮加载数据：~/.dsh/storages/elysium
- 加载 .claude/ — 调研、计划、实施与进度规范

## 执行方式
- 明确的实施需求直接执行，不要求用户再次回复“确认执行”。跨模块改动先说明计划，再连续完成实施与验证。
- `.claude/` 中的阶段划分用于组织工作，不是人工审批关卡；只有用户明确要求等待、关键需求无法判断或更高优先级规则要求授权时才暂停。

## 远程主机
- 检查服务： `~/.ssh/config`
- runpod服务器(ComfyUI)：`ssh veo-comfyui`
- autodl服务器(Qwen3.8)： `ssh veo-qwen38`
