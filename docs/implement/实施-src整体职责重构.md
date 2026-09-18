# src 整体职责重构实施记录

## 已修改文件

- `dsh-elysium/src/client/` — API 集中到 `api/`，任务卡迁入 `workcard/`。
- `dsh-elysium/src/server/` — 集中 HTTP 路由、领域服务、任务以及图片、视频、短剧工作流。
- `dsh-elysium/src/database/` — 集中路径、持久化 schema、原子 JSON、素材、导演、项目、生产、连接、选择和设置数据管理器；不反向依赖 Server。
- `dsh-elysium/src/server/{projects,directors}/service.js` — 组合领域服务依赖，项目服务注入任务查询和媒体可用性检查。
- `dsh-elysium/src/tools/` — 只保留 Harness 工具、工具上下文、输出和提示词；图片及角色执行迁入 Server。
- `dsh-elysium/src/models/` — 集中 ComfyUI 协议、Provider 和注册、运行、选择、设置、连接管理器。
- `dsh-elysium/src/utils/` — 只保留异步上下文、通用状态错误和配置校验。
- `dsh-elysium/src/config.js`、`src/index.js` — 分别承担实例配置组合和唯一插件组合入口。
- `dsh-elysium/scripts/`、`tests/`、`README.md`、`.claude/standards.md` — 更新构建路径、测试引用、架构约束与说明。

## 验收标准核对

| AC | 状态 | 验证方式与证据 |
|----|------|--------------|
| AC-1 | 通过 | `architecture-layout.test.js` 验证新一级目录及旧目录消失。 |
| AC-2 | 通过 | 图片和角色执行位于 `server/workflows/images/`；工具发现与图片测试通过。 |
| AC-3 | 通过 | `database/index.js` 统一导出路径、JSON 和数据管理器；架构测试确认 Database 不反向导入 Server；存储与设置测试通过。 |
| AC-4 | 通过 | 架构测试检查三个 Utils 文件不含业务词汇。 |
| AC-5 | 通过 | Provider 边界和物理删除 Provider 场景通过。 |
| AC-6 | 通过 | 插件测试 190/190、Harness 测试 10/10；构建、打包、安装、重启及 HTTP 401 身份检查通过。 |

## 人工待办

- [ ] 无
