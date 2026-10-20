# Agent Harness

可复制的 Agent 项目工作区。公共能力放在 `packages`，具体业务放在 `projects`；当前业务项目为短剧制作 Agent meiji。

```text
agent-harness/
├─ packages/
│  ├─ http-client/          # 文本、图片、视频、下载、HTTP记录与异步恢复
│  └─ prompt-composer/      # 模板、章节和消息编排
├─ projects/
│  └─ meiji/               # 短剧规则、业务流程、数据模型、界面和测试
├─ scripts/                # 项目选择、复制/安装验证和工程测试
├─ examples/               # 不调用真实模型的公共能力示例
├─ docs/                   # 仓库计划与实施记录
├─ package.json            # npm workspaces 和统一命令
└─ package-lock.json       # 唯一依赖锁文件
```

## 安装与验证

要求 Node.js ^22.19.0 或 >=24；meiji 媒体步骤和相关测试需要 FFmpeg。

```sh
npm ci
npm test
npm run example
npm run verify:install
npm run verify:copy
```

`npm test` 执行所有工作区测试和工程入口测试；也可使用 `npm test --workspace @meiji/harness-plugin` 单独验证 meiji。两个公共包是工作区本地链接，修改源码即时被业务导入，不需要复制到另一份 node_modules。

`example` 和打包/复制验证使用本机模拟 HTTP，不调用真实模型。`verify:install` 验证两个 npm tarball 的独立安装；`verify:copy` 复制仓库到临时目录，只调整项目目录及包名，自动更新锁文件后离线安装、导入插件和运行示例。离线验证依赖已安装后的 npm 缓存。

## 使用业务项目

```sh
npm run configure -- meiji
npm run restart -- meiji
```

只有一个业务项目时可以省略参数；多个项目时须传项目目录名，或设置 `AGENT_PROJECT`。`configure` 链接所选项目到外部 DeepSeek Harness 并启动 Web；`restart` 仅用于已配置环境，预检插件链接和端口进程归属后正常停止旧实例再启动。可用 `HARNESS_DIR` 指定宿主源码目录，默认使用本仓库的并列 `deepseek-harness`。

上游 DeepSeek Harness 与 [meiji-server](../meiji-server/README.md) 分别负责宿主和实际模型服务，不包含在本仓库内。真实供应商密钥由模型服务端管理，meiji 只连接配置的服务地址。

## 复制后开发新 Agent

1. 复制仓库源码，排除 `.git`、`.gitnexus`、`node_modules`、本地配置和运行数据；为新项目建立自己的 Git 仓库。
2. 在 `projects` 修改业务代码。可保留模板目录，也可改成新的项目目录；同步修改该项目 `package.json` 的包名、插件入口与 `cordis.patch.yml` 中的注册名。
3. 在项目内部修改规则、提示词模板、业务流程、界面及测试。若要与 meiji 共用一个宿主，给新 Agent 设置独立插件/工具名、API 前缀和存储目录，避免业务标识冲突。
4. 项目清单或依赖变化后在根运行 `npm install`，由 npm 自动更新根锁文件；之后使用 `npm ci`。根 workspaces 已匹配 `projects/*`，启动脚本按项目目录及其包名处理，无需为新项目改根脚本。

公共包不反向引用业务项目。新增通用能力时修改 `packages`；业务规则仍由各项目自己维护。任务系统目前还在 meiji 内，尚未提取成公共包。

公共包以独立安装和运行作为验收标准，不为旧 meiji 接入增加历史兼容分支。旧 Elysium 媒体代码暂留 `projects/meiji/server/http/elysium/legacy`，不在公共包导出或分发，待 meiji 自身重构时处理。公共文本客户端接受调用方的模型名，错误保留服务真实 HTTP 状态。

## 文档

- [通用工作区开发指引](.agents/agent-harness-dev.md)
- [meiji 项目说明](projects/meiji/README.md)及[项目规范](projects/meiji/AGENTS.md)
- [HTTP 与模型接口](packages/http-client/README.md)
- [提示词编排](packages/prompt-composer/README.md)

本次重组保留原仓库 Git 历史与已有未提交变更，未更改远端仓库地址，也未自动提交、发布或启动生产服务。历史计划里的旧路径用于追溯，当前入口以本文为准。
