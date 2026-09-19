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
│   ├── database/       # 唯一文件系统入口、数据路径、持久化 schema、原子 JSON 与集中数据管理器
│   ├── session/        # ① Harness 会话入口：预设识别、事件解析（加载/失败/重试意图）、每轮工具投影、创作提示词
│   ├── tools/          # ② Harness 工具定义：只有参数 schema，执行调用 worker 门面
│   │   ├── load.js  # call_tools_load 按需加载
│   │   ├── media/   # 图片、视频生成与恢复
│   │   ├── project/ # 项目和导演
│   │   ├── card/    # 工具输出的工作卡摘要
│   │   └── task/    # 任务状态与结果查询
│   ├── worker/         # ③ 持久化任务驱动与模型层
│   │   ├── index.js    # 唯一门面：提交/管理命令/驱动器/waitJob/getJob/结果汇总/模型设置
│   │   ├── manager/    # 任务受理、持久化队列、派发、结算、回写与管理命令
│   │   ├── driver/     # 对账、观察、结算与全局单并发派发循环
│   │   ├── intake/     # 受理：媒体工具名单、运行中调用关联、项目归属
│   │   ├── routing/    # 新任务路由：自有优先、三方回退、质量档位、计划校验
│   │   ├── store/      # 存储：路径、任务记录、状态机（唯一写入口）、锁、媒体登记
│   │   ├── runner/     # 执行：launcher、worker 进程、TaskContext、进程归属、等待
│   │   ├── results/    # 汇总：结果摘要、代码指纹与诊断
│   │   └── models/     # 模型层：只依赖 contract.js 与注入的 TaskContext
│   │       ├── index.js    # 模型层唯一入口
│   │       ├── contract.js # 业务词汇、Provider 接口、TaskContext
│   │       ├── catalog/    # provider 加载、定义、服务器登记与选择、连接
│   │       ├── protocols/  # 公共协议（ComfyUI runner、客户端、标准适配器）
│   │       └── providers/  # 平台专属实现、模板、档位与材料
│   └── utils/          # 跨模块共享的上下文、结构化错误和校验工具
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
- `src/index.js` 是唯一组合入口；Client 只调用 `server/routes/`，Harness 工具只位于 `src/tools/`，会话投影只位于 `src/session/`。
- 依赖单向：session / tools / server → `worker/index.js` → manager | driver → intake | routing | store | runner | results → `worker/models/index.js`；worker 不得导入 session、tools、server 或 client；models 不得导入 worker 上层，只经 contract 与 TaskContext 交互（`architecture-layout.test.js` 强制）。
- `src/server/` 只承载 Client 工作台 HTTP 边界与共享 Store；任务生命周期、路由和执行只位于 `src/worker/`。
- 所有源码文件读取、保存和修改都必须经过 `src/database/files.js`；`src/database/` 外不得直接导入 `node:fs` 或操作原始文件句柄。数据目录、原子 JSON 和持久化管理器集中在 `src/database/`；`src/utils/` 除共享结构化错误外，不得出现项目、导演、素材、任务、模型或平台业务语义。
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
│   └── agent.cordis.yml    # 共享模板（free/director 共用）
├── elysium-free/
│   ├── preset.yml          # 名称、描述、排序
│   ├── agent.cordis.yml    # → ../_base/agent.cordis.yml（符号链接）
│   ├── persona.md          # 人设提示词
│   └── rules.md            # 行为规则
├── elysium-director/       # 同上结构
└── elysium-standard/       # 独立 cordis（原生完整工具）
    ├── preset.yml
    └── agent.cordis.yml
```

**规则**：
- free/director 两个预设共享同一份 `agent.cordis.yml`，通过符号链接指向 `_base/agent.cordis.yml`。
- free/director 使用相同的创作行为；free 保存到不可见内部工作区，director 创建或复用用户项目。
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
- Elysium 根目录只包含 `config/`、`pools/`、`projects/`、`runtime/`、`uploads/` 五类业务目录：配置和凭据归 `config/`，跨项目主数据归 `pools/`（导演库 `directors.json`、素材库索引 `materials.json`），项目拥有的任务、回执和媒体随项目归 `projects/`，任务驱动状态归 `runtime/`，导入原件归 `uploads/`。
- `pools/materials.json` 只保存全局素材的身份、来源和删除状态；媒体实体不复制，仍保留在所属 `projects/` 或 `uploads/`。各项目的 `materials.json` 只保存项目引用。
- 一级目录路径统一由 `src/database/paths.js` 构造；业务模块不得自行拼接一级目录。Harness 会话日志是工具调用与任务结果的事实源，插件不得重复持久化调用索引。
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
