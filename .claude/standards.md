# 项目约定

本文件定义项目结构与编码约定，所有阶段（调研/计划/实施）均须遵守。

## 1. 插件结构

项目仅包含 dsh-elysium 插件。

```
dsh-elysium/
├── src/                # 源代码
│   ├── index.js        # 插件入口，导出 name / inject / apply
│   ├── config.js       # 插件实例配置组合
│   ├── client/         # React.createElement，无 JSX
│   │   ├── api/        # Client 到 Server 的调用
│   │   ├── workcard/   # 会话任务状态与结果卡片
│   │   └── workbench/  # 素材、项目、锚点、分镜与交付工作台
│   ├── server/         # Client 工作台 HTTP 接口与共享 Store
│   │   ├── routes/     # 媒体、项目、导演和设置接口
│   │   ├── media/      # 素材查询与访问校验
│   │   ├── projects/   # 项目领域校验
│   │   └── directors/  # 导演 Store
│   ├── database/       # 数据路径、持久化 schema、原子 JSON 与集中数据管理器
│   ├── tools/          # Harness 对外工具边界与按需发现
│   │   ├── prompts/ # Harness 系统提示词片段
│   │   ├── media/   # 图片、视频和角色工具适配
│   │   ├── project/ # 项目和导演工具适配
│   │   └── task/    # 模型任务和 ComfyUI 原生任务工具
│   ├── worker/         # 异步任务、模型和 Worker 公共入口
│   │   ├── tasks/      # 任务生命周期与图片、视频工作流
│   │   │   ├── jobs/       # 创建、查询、锁、诊断和等待
│   │   │   ├── images/     # 图片任务编排
│   │   │   ├── videos/     # 视频任务编排
│   │   │   ├── runtime/    # 通用 launcher 与 worker 进程
│   │   │   └── bindings/   # Harness 调用与任务绑定
│   │   └── models/     # 模型协议、平台和运行管理器
│   │       ├── protocols/  # 公共模型协议
│   │       ├── managers/   # 注册、运行、选择、设置和连接管理
│   │       └── providers/  # 平台专属实现、模板、测试与材料
│   └── utils/          # 无业务语义的上下文、错误和校验工具
├── scripts/            # 构建脚本（统一目录名）
│   ├── build.mjs       # src → lib + 生成 client.js
│   ├── loader.js        # 客户端模块拼接
│   ├── deploy.mjs      # 同步或检查平台工作流
│   └── registry.mjs       # 组装 registry/
├── tests/              # 单元测试
├── lib/                # 构建产物（git-ignored）
├── registry/           # 发布产物（git-ignored）
├── package.json
└── README.md
```

**规则**：
- 构建脚本目录统一命名为 `scripts/`。
- `src/index.js` 是唯一组合入口；Client 只调用 `server/routes/`，Harness 工具只位于 `src/tools/`。
- `src/server/` 只承载 Client 工作台 HTTP 边界与共享 Store；任务生命周期、工作流和 worker 进程只位于 `src/worker/tasks/`。
- 数据目录、原子 JSON 和持久化管理器集中在 `src/database/`；`src/utils/` 不得出现项目、导演、素材、任务、模型或平台业务语义。
- 平台专属实现、原始工作流模板、档位、测试与运维材料只位于 `src/worker/models/providers/<id>/`；外部通过配置和公共路由选择平台。平台 tests/legacy/resources 不进入运行包；`npm test` 动态发现平台测试。
- `package.json` 中 `scripts.build` 和 `scripts.package:registry` 指向 `scripts/` 下的脚本。
- 插件 Cordis 装配统一位于 `harness/.dsh/profiles/web/cordis.patch.yml`，插件包不自带 Harness 运行配置。
- 新增客户端模块（含 `workbench/`）后须同步更新 `scripts/loader.js` 的模块列表，依赖在前、`index.js` 最后。
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
harness/scripts/tunnel.mjs # 本机模型隧道路由
harness/.dsh/               # 可直接覆盖的 Harness 主目录模板
```

**规则**：
- `harness/.dsh/` 逐项覆盖到本机 `~/.dsh/`，不删除本机其他文件。
- Elysium 的项目、任务、上传、导演、服务器、模型选择和平台配置统一位于 `$DSH_HOME/storages/elysium`；未显式覆盖的运行路径不得读写 `~/.elysium`。
- Elysium 根目录只包含 `config/`、`pools/`、`projects/`、`runtime/`、`uploads/` 五类业务目录：配置和凭据归 `config/`，跨项目主数据归 `pools/`（导演库 `directors.json`、素材库索引 `materials.json`），项目拥有的任务、回执和媒体随项目归 `projects/`，跨会话索引和隧道归 `runtime/`，导入原件归 `uploads/`。
- `pools/materials.json` 只保存全局素材的身份、来源和删除状态；媒体实体不复制，仍保留在所属 `projects/` 或 `uploads/`。各项目的 `materials.json` 只保存项目引用。
- 一级目录路径统一由 `src/database/paths.js` 构造；业务模块不得自行拼接一级目录。`runtime/` 中的调用和会话索引参与任务恢复，不得视为可随意清空的缓存。
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

- 原有 Runpod H3 模板与完整 UI 元数据位于 `src/worker/models/providers/runpod/workflows/minimax-h3/`，迁移不得删字段或重写原始内容；公共同步脚本只负责平台路由。
