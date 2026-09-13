# Harness 设置合并

统一使用 `harness/config/settings.yaml`，保留原本机配置的启动、隧道、模型、界面和插件定制字段，以及 `danger-full-access` 权限。删除重复的 `harness-settings.yaml`。

`app/common` 中的配置解析、启动、部署、ComfyUI 检查和 Qwen 隧道入口均读取统一配置。`config_loader.sh render` 移除运行参数及定制段并替换占位符；`shell` 输出启动脚本需要的变量。

远端 Harness 部署入口已删除；远端主机只保留模型服务。本机配置解析不需要额外运行时依赖。
