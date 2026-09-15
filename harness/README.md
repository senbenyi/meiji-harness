# Harness 本机运行
`harness/` 只负责本机 Harness 的安装、启动和配置，不执行远端模型服务操作。

## 环境要求
- Node.js 20.16 或更高版本
- pnpm

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
环境、`~/.dsh/.credentials.yaml`、`.env` `.env`。

## 配置
- `harness/.dsh/settings.yaml`：Harness 与模型服务地址。
- `harness/.dsh/profiles/web/`：Web profile 和插件装配配置。
- `harness/.dsh/.agent-presets/`：标准、教学、自由和导演模式。
- `harness/.dsh/.env.example`：本机环境变量模板；复制为 `.env` 后填写实际值。
- `~/.dsh/.credentials.yaml`：Harness 在本机生成的凭据，不进入仓库。


