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

## 香港生成服务器

在本仓库根目录执行 `node harness/scripts/deploy-hk.mjs`。先用 `--dry-run` 查看目标与步骤。脚本通过 `veo-hk` 安装香港运行依赖、同步当前工作树、安装 Harness、插件和默认 Skill，并启动仅监听 `127.0.0.1:3080` 的 Harness。

香港 Harness 与 Elysium 使用香港本机反向端口：Qwen `http://127.0.0.1:28000/v1`，ComfyUI `http://127.0.0.1:26016`。本机模板和已有运行配置继续使用公网网关。香港使用全新 `~/.dsh/storages/elysium`，不会迁移本机项目或历史任务；远端已有同名 Skill 内容不同时，安装会停止。

本机浏览器访问香港 Harness：先运行 `ssh -N -L 3080:127.0.0.1:3080 veo-hk`，再打开 `http://127.0.0.1:3080/`。
