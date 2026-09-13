# Harness 设置合并

统一使用 `harness/config/settings.yaml`，保留原本机配置的启动、隧道、模型、界面和插件定制字段，以及 `danger-full-access` 权限。删除重复的 `harness-settings.yaml`。

`app/common` 中的配置解析、部署、ComfyUI 检查和 Qwen 隧道入口均读取统一配置。`config_loader.sh render` 生成 `$DSH_HOME/settings.yaml`；`profile` 生成 web profile 的 `cordis.patch.yml`；`shell` 输出本机脚本需要的变量。

远端 Harness 部署入口已删除；远端主机只保留模型服务。本机配置解析不需要额外运行时依赖。

`app/deploy_dsh_elysium_tools_local.sh` 支持空的 `DSH_HOME`：初始化 web profile，测试、构建、打包并注册插件，再同步用户设置、profile 覆盖和项目管理的五个 preset。脚本不启动 Harness、不建立隧道，也不访问模型服务；安装完成后由用户手动运行 `dsh web` 验收。重复执行会更新这五个 preset，同时保留其他本机 preset。
