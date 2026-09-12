# Harness 设置合并

统一使用 `harness/config/settings.yaml`，保留原本机配置的启动、隧道、模型、界面和插件定制字段，以及 `danger-full-access` 权限。删除重复的 `harness-settings.yaml`。

`app/common` 中的配置解析、启动、部署、ComfyUI 检查和 Qwen 隧道入口均读取统一配置。`config_loader.py render` 移除运行参数及定制段并替换占位符；`shell` 输出启动脚本需要的变量。

旧 `harness/deploy.sh` 改为调用同一解析器生成运行配置，不再直接复制模板，依赖 Python 3、PyYAML 以及仓库相对位置的解析器。本次不执行旧远端部署，也不修改本机已运行服务的配置。
