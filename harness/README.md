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

## 开发修改生效
```sh
(cd dsh-elysium && pnpm build && pnpm package:registry) && DSH_NO_OPEN=1 node harness/scripts/start.mjs
```

## 凭据
本机 Qwen 的固定 API Key 直接配置在 `settings.yaml`；其他 Harness 凭据使用进程环境或 `~/.dsh/.credentials.yaml`。

## 配置
- `harness/.dsh/settings.yaml`：Harness 与模型服务地址。
- `harness/.dsh/profiles/web/`：Web profile 和插件装配配置。
- `harness/.dsh/.agent-presets/`：标准、自由和导演模式；自由模式不创建用户项目，导演模式创建或复用用户项目。
- `~/.dsh/.credentials.yaml`：Harness 在本机生成的凭据，不进入仓库。

Elysium 的模型选择、服务器、提供者凭据和业务数据统一位于 `~/.elysium`，不由 Harness 安装或启动脚本读写。
