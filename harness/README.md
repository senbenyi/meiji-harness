# Harness 本机运行

`harness/` 只负责本机 Harness 的安装、启动和配置，不执行远端模型服务操作。

## 环境要求

- Node.js 20.16 或更高版本
- pnpm

## 安装

```sh
node harness/scripts/install.mjs
```

脚本在本机不存在 `dsh` 时安装 Harness，将 `harness/.dsh/` 中的托管配置覆盖到 `~/.dsh/`，但不复制凭据和环境变量模板；随后构建并安装 `dsh-elysium` 插件依赖。本机其他 `.dsh` 文件不会被删除。

## 启动

```sh
node harness/scripts/start.mjs
```

## 配置

- `harness/.dsh/settings.yaml`：Harness 与模型服务地址。
- `harness/.dsh/profiles/web/`：Web profile 和插件装配配置。
- `harness/.dsh/.agent-presets/`：标准、教学、自由和导演模式。
- `harness/.dsh/.env.example`：本机环境变量模板；复制为 `.env` 后填写实际值。
- `~/.dsh/.credentials.yaml`：Harness 在本机生成的凭据，不进入仓库。

凭据读取优先级为：启动进程环境变量、`~/.dsh/.credentials.yaml`、项目目录 `.env`、DSH 主目录 `.env`。

远端 ComfyUI 和 Qwen 运维见 [RunPod 说明](../runpod/README.md)。
