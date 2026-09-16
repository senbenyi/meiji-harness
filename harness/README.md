# Harness 本机运行
`harness/` 只负责本机 Harness 的安装、启动和配置，不执行远端模型服务操作。

## 安装
```sh
node harness/scripts/install.mjs
```

## 启动
```sh
node harness/scripts/start.mjs
```

## 隧道
```sh
node harness/scripts/tunnel.mjs qwen`
```

## 凭据
环境、`~/.dsh/.credentials.yaml`、`.env`。

## 配置
- `harness/.dsh/settings.yaml`：Harness 与模型服务地址。
- `harness/.dsh/profiles/web/`：Web profile 和插件装配配置。
- `harness/.dsh/.agent-presets/`：标准、教学、自由和导演模式。
- `harness/.dsh/.env.example`：本机环境变量模板；复制为 `.env` 后填写实际值。
- `~/.dsh/.credentials.yaml`：Harness 在本机生成的凭据，不进入仓库。



- `harness/.dsh/bailian.json`：独立百炼渠道配置，参照 `dsh-elysium/src/servers/providers/bailian/config.example.json` 创建；实际凭据文件忽略提交。
- 启动脚本分别解析百炼和 BytePlus 配置：环境变量优先，其次仓库本地文件，最后 `$DSH_HOME` 文件。
- 安装仅在目标缺少渠道配置时复制空模板，保留已有配置及凭据，并将权限设为 `0600`。
