# llm-dsh-plugins

- [dsh-elysium-ui](./dsh-elysium-ui/README.md)：Harness 原生导演设置页面。
- [dsh-elysium-tools](./dsh-elysium-tools/README.md)：Endpoint 能力工具及任务查询。

## 工具插件部署

配置由 `config/harness-settings.yaml` 管理。脚本上传 `.dsh`、配置和脚本，本地构建工具插件后上传，再于服务器安装、重启和检查。

```sh
bash app/deploy_dsh_elysium_tools.sh
```

服务器需要预先安装 Harness 和模型执行环境；UI 插件单独安装。
