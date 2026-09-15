# 项目约定

本文件定义项目结构与编码约定，所有阶段（调研/计划/实施）均须遵守。

## 1. 插件结构

项目仅包含 dsh-elysium 插件。

```
dsh-elysium/
├── src/                # 源代码
│   ├── index.js        # 插件入口，导出 name / inject / apply
│   ├── tools/          # Harness 工具定义与按需发现
│   ├── business/       # 内部业务包，随现有插件发布
│   │   ├── projects/   # 项目领域校验与持久化
│   │   ├── directors/  # 导演库
│   │   ├── assets/     # 素材目录查询与访问校验
│   │   ├── jobs/       # 任务持久化、查询、诊断与进程锁
│   │   ├── video/      # 视频任务服务、执行与 worker
│   │   └── production/ # 多镜头生产编排（源码 CLI）
│   ├── servers/        # 配置、连接、检查与平台适配器
│   ├── comfyui/        # 公共 ComfyUI 协议
│   ├── http/           # 媒体与项目 HTTP 路由适配
│   ├── prompts/        # 系统提示词片段
│   └── client/         # React.createElement，无 JSX
│       ├── commands/   # 创作命令
│       ├── media/      # 会话媒体状态与卡片
│       └── workbench/  # 素材、项目、锚点、分镜与交付工作台
├── scripts/            # 构建脚本（统一目录名）
│   ├── build.mjs       # src → lib + 生成 client.js
│   ├── client-source.mjs # 客户端模块拼接
│   └── package-registry.mjs # 组装 registry/
├── tests/              # 单元测试
├── lib/                # 构建产物（git-ignored）
├── registry/           # 发布产物（git-ignored）
├── package.json
└── README.md
```

**规则**：
- 构建脚本目录统一命名为 `scripts/`。
- 平台专属实现、原始工作流模板、档位、测试与运维材料只位于 `src/servers/providers/<id>/`；外部通过配置和公共路由选择平台。平台 tests/legacy/resources 不进入运行包；`npm test` 动态发现平台测试。
- `package.json` 中 `scripts.build` 和 `scripts.package:registry` 指向 `scripts/` 下的脚本。
- 插件 Cordis 装配统一位于 `harness/.dsh/profiles/web/cordis.patch.yml`，插件包不自带 Harness 运行配置。
- 新增客户端模块（含 `workbench/`）后须同步更新 `scripts/client-source.mjs` 的模块列表，依赖在前、`index.js` 最后。
- `workbench/` 使用 `load(name, (require, exports) => { ... })` 定义模块；拼接脚本适配宿主的 `{ id, factory }` 注册格式，不引入 bundler。
- 媒体及项目端点共用注入 token，客户端通过 `mediaUrl()` 构建带凭据的 URL。用户下载流式代理上游，不保存媒体文件；项目 JSON 使用临时文件加 rename 原子写入。

## 2. 预设结构

预设位于 `harness/.dsh/.agent-presets/`。

```
harness/.dsh/.agent-presets/
├── _base/                  # 公共基础 cordis 配置
│   └── agent.cordis.yml    # 共享模板（teaching/free/director 共用）
├── elysium-teaching/
│   ├── preset.yml          # 名称、描述、排序
│   ├── agent.cordis.yml    # → ../_base/agent.cordis.yml（符号链接）
│   ├── persona.md          # 人设提示词
│   └── rules.md            # 行为规则
├── elysium-free/           # 同上结构
├── elysium-director/       # 同上结构
└── elysium-standard/       # 独立 cordis（原生完整工具）
    ├── preset.yml
    └── agent.cordis.yml
```

**规则**：
- teaching/free/director 三个预设共享同一份 `agent.cordis.yml`，通过符号链接指向 `_base/agent.cordis.yml`。
- 修改共享配置只改 `_base/agent.cordis.yml` 一处。
- elysium-standard 保持独立配置（工具集不同）。
- 预设目录不保留空 `skills/` 目录；仅在有实际技能文件时创建。

## 3. 部署与配置

```
harness/scripts/install.mjs # 本机 Harness 与插件安装入口
harness/scripts/start.mjs   # 本机 Harness 启动入口
dsh-elysium/scripts/server-service.mjs # 通用平台服务管理路由
harness/scripts/tunnel.mjs # 本机模型隧道路由
harness/.dsh/               # 可直接覆盖的 Harness 主目录模板
```

**规则**：
- `harness/.dsh/` 逐项覆盖到本机 `~/.dsh/`，不删除本机其他文件。
- 部署脚本不检查模型服务、SSH、端口或运行状态。
- Harness 只在本机运行；远端服务器只保留模型服务。

## 4. 测试

```
tests/                     # 项目级测试（部署、配置、预设）
dsh-elysium/tests/         # 插件单元测试
```

**规则**：
- Node.js 测试用 `node --test`，Python 测试用 `unittest`。
- 新增工具/功能必须有对应测试。

## 5. 铁律

- 插件不允许上传、下载、保存文件方法。
- 插件中媒体、视频、图片一律使用服务器 URL。
- Harness 只在本机运行；远端服务器只保留模型服务。

- 原有 Runpod H3 模板与完整 UI 元数据位于 `src/servers/providers/runpod/workflows/minimax-h3/`，迁移不得删字段或重写原始内容；公共同步脚本只负责平台路由。
