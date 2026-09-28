# 项目目录架构

meiji（`@meiji/harness-plugin`）是 DeepSeek Harness 的外部插件：在 Harness 页面挂载短剧制作面板，并向 Harness agent 注册会话工具，完成“剧情 → 镜头 → 分镜 → 图片 → 视频 → 合片”的生成流程。不修改上游 Harness。

本文件描述现状；与代码不符时以代码为准，并在同一任务中修正本文件。

## 1. 仓库

```
llm-dsh-plugins/
├── configure-harness.sh    # 把 meiji 链接到同级 deepseek-harness 并启动 Web（3080）
├── docs/                   # 流程文档：research/ plans/ implement/（按需创建）
└── meiji/                  # 插件本体，见第 2 节
```

## 2. 插件

```
meiji/
├── index.js                # 唯一组合入口：导出 name / inject / apply
├── package.json            # type: module；npm test
├── cordis.patch.yml        # 由 configure-harness.sh 生成，勿手改
├── client/                 # 浏览器原生 ES 模块，平铺、无子目录、无构建
│   ├── panel.js            # 面板入口：由 routes.js 通过 webserver/index-inject 注入 Harness 页面，
│   │                       #   动态 import('/plugins/meiji/client/app.js') 后调用 mount()
│   │                       #   mount()：在 Harness 页面挂载 <meiji-workbench> 右栏（外壳、任务停止栏、项目/片库视图），已挂载则跳过
│   ├── app.js / shell.js   # 组合与右栏外壳
│   ├── api.js / dom.js     # 同源请求与 DOM 组件
│   ├── drama-model.js      # 剧集数据模型（schemaVersion 2），客户端与服务端共用
│   └── styles.css
├── server/
│   ├── http/               # routes.js 鉴权路由与 client 静态分发；library-routes.js 素材导入/读取/Range
│   ├── data/               # 持久化：projects、episodes、library、links、models、task-records 等
│   ├── flow/               # gates 门禁、actions、tasks 任务、interrupt、session-log、text-workflow
│   ├── generate/           # gateway 网关、chat、story、image、film、concat、review 等生成调用
│   ├── prompts/            # 各阶段提示词拼装
│   └── workers/            # shot-film-worker、text-request-worker
├── models/router.js        # 用途（chat/story/image/video）→ 模型路由与校验
├── config/models.json      # 网关地址与模型名默认配置（入 git，不含密钥）
├── config/models.local.json # 本地密钥，覆盖 models.json 同名字段（git 忽略，需自行创建）
├── tools/                  # Harness 会话工具 session-*-tool.js（4 个）
├── skills/                 # 运行时 skill，load.js 注册；references/minimax-h3 为引用资料
├── h3skill/                # MiniMax-H3 官方 skill 归档，只读参考，不注册、不注入
├── scripts/                # 一次性迁移脚本，参数为 DSH_HOME
├── tests/                  # node --test；fixtures/
├── docs/                   # 架构与数据说明
└── reports/                # 本地生成报告（git-ignored）
```

## 3. 模块职责与调用链

| 目录 | 职责 |
|---|---|
| `index.js` | `apply(ctx)`：启动时中断遗留任务、创建任务管理器、注册面板路由、4 个会话工具和 skills |
| `client/` | 右栏面板 UI；通过 `api.js` 调用 `/plugins/meiji/*` 接口 |
| `server/http/` | 鉴权、同源校验、分发面板操作到 `flow/`，素材上传下载与 Range |
| `server/flow/` | 操作入口 `actions.js`（`runOperation`）、门禁 `gates.js`、任务 `tasks.js`、重启中断、会话日志 |
| `server/generate/` | 调用网关：文本、图片、视频提交与轮询、审核、ffmpeg 抽帧与拼接 |
| `server/prompts/` | 按阶段拼装提示词，组合 skill 与指导素材 |
| `server/workers/` | 逐镜成片、文本请求等长流程 |
| `server/data/` | 项目、剧集、素材、图片、任务记录等持久化 |
| `models/`、`config/` | 模型路由与默认配置 |
| `tools/` | Harness agent 可调用的工具：上下文查询、项目管理、内容生成、任务控制 |
| `skills/` | 各阶段生成与审核规则（Markdown），由 `load.js` 注册 |

```text
面板操作：client → server/http/routes.js → flow/tasks.js → flow/actions.js(runOperation)
                                              → generate/*（网关） → data/*（落盘）
会话操作：Harness agent → tools/session-*-tool.js → flow/tasks.js → 同上
```

## 4. 运行数据

持久化根目录为 `$DSH_HOME/storages/meiji/`（`DSH_HOME` 缺省为 `~/.dsh`），源码与用户数据分离。

```
storages/meiji/
├── models.json                     # 运行中模型配置，文本/图片/视频共用
├── projects/<projectId>.json       # 项目主 JSON（revision 递增）
├── projects/<projectId>/           # 专属工作区：images/ films/ boards/ covers/ history/
├── assets/<category>/<assetId>/    # 全局素材：characters scenes props audio video guidance
├── image-drafts/<draftId>/         # 待确认图片预览
└── incoming/                       # 导入暂存
```
