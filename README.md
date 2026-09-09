# llm-dsh-plugins

两个插件可分别完整安装到本地或服务器，互不依赖。工具包自带媒体卡片、Elysium preset、人格、指令和创作技能；UI 包独立提供导演管理。配置方式见 [独立安装配置](dsh-elysium-tools/README.md#独立安装配置)。下方 `app/` 脚本是服务器部署方案，不是插件运行前提。

- [dsh-elysium-ui](./dsh-elysium-ui/README.md)：Harness 原生导演设置页面。
- [dsh-elysium-tools](./dsh-elysium-tools/README.md)：生成工具、任务查询与媒体卡片。

## 工具插件部署

配置由 `app/config/harness-settings.yaml` 管理。脚本上传部署配置和脚本，本地构建工具插件后上传，再于服务器安装、重启和检查。

```sh
bash app/deploy_dsh_elysium_tools.sh
```

服务器需要预先安装 Harness 和模型执行环境；UI 插件单独安装。
