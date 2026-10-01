# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 执行铁律
- 职责分离：包、文件、类、方法名称 简要说明职责
- 加载 .claude/ — 调研、计划、实施与进度规范

## 远程主机
- 检查服务： `~/.ssh/config`
- autodl服务器(ComfyUI)：`ssh veo-comfyui`
- autodl服务器(Qwen3.8)： `ssh veo-qwen38`
- 项目服务使用外网 HTTP(S) 地址；SSH 别名仅用于运维登录，不用于模型连接
- 换电脑：运行时只需复制 `~/.dsh/storages/elysium`；运维 SSH 配置见 `init/README.md`
