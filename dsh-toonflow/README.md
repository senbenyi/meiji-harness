# dsh-toonflow

DeepSeek Harness 的 AI 短剧可视化操作台与编排插件。

## 结构约定

```text
dsh-toonflow/
├── package.json
├── cordis.patch.yml
├── src/client/                 # 客户端唯一源码
│   ├── index.js                # ModuleLoader + sidebar 注册
│   ├── ToonflowApp.js          # 页面路由与 tab.meta
│   ├── api.js                  # /toonflow/api 与媒体 URL
│   ├── toonflow.module.css
│   ├── hooks/                  # 数据加载与状态 Hook
│   ├── views/                  # 五个页面
│   └── components/             # 可复用 UI 组件
├── lib/                        # DSH 实际加载的发布产物
│   ├── index.js                # Host 入口与 HTTP 路由
│   ├── client.js               # npm run build 生成，禁止手改
│   └── lib/
│       ├── project.js          # 项目 CRUD
│       ├── plan.js             # 计划读取与镜头编辑
│       ├── schema.js           # 输入校验
│       └── store.js            # 原子 JSON 存储与路径边界
├── scripts/                    # 构建脚本
├── skills/                     # Phase 5 Agent 技能文件
└── tests/                      # 与 Host 模块同名的测试
```

后续阶段按职责新增文件，不把逻辑堆回入口：Phase 3 使用
`lib/lib/generate.js`、`assets.js`、`shot.js` 和 `src/client/hooks/usePolling.js`；
Phase 4 使用 `lib/lib/export.js`；Phase 5 使用 `lib/lib/tools.js` 与 `skills/`。

## 命令

```sh
npm install
npm run build
npm test
```

客户端修改只编辑 `src/client/`，随后执行 `npm run build` 更新
`lib/client.js`。Host 文件直接位于 `lib/`，不经过编译。

## 数据目录

`cordis.patch.yml` 默认配置 `workspace: './toonflow-workspace'`。相对路径以
DSH 进程的当前工作目录为基准；需要稳定位置时应配置绝对路径。
