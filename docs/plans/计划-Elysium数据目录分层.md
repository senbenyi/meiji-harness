# Elysium 数据目录分层

- 类型：架构整理与数据迁移
- 目标：`$DSH_HOME/storages/elysium` 成为唯一数据根，并将所有数据稳定划分到 `config`、`pools`、`projects`、`runtime`、`uploads`。

## 已确认的目录职责

| 目录 | 职责 | 典型内容 |
|---|---|---|
| `config/` | 本机配置与凭据 | `servers.json`、`selection.json`、`providers/*.json` |
| `pools/` | 所有项目共享的持久主数据 | `directors.json` |
| `projects/<id>/` | 项目拥有的完整持久数据 | 项目对象、任务、生产回执、媒体清单 |
| `runtime/` | 跨项目、跨会话的运行状态 | 调用绑定、会话、隧道、迁移备份 |
| `uploads/` | 用户导入的原始文件 | 图片、视频及其索引 |

`projects` 不等于只读静态数据：任务快照、恢复回执和项目媒体决定幂等与恢复，必须跟随项目持久保存。`runtime` 保存任务驱动状态；工具调用与任务结果的关系由 Harness 会话日志提供。

## 执行阶段

### 阶段 1：统一路径入口

- 新增 `src/utils/storage-paths.js`，集中构造五个一级目录。
- 业务模块只使用统一路径入口，不再自行拼接一级目录。
- 默认连接、模型选择、平台配置分别落到 `config/servers.json`、`config/selection.json`、`config/providers/`。
- 导演库固定落到 `pools/directors.json`。

验证：目录单测覆盖五类根路径；配置测试覆盖构建产物实际解析路径。

### 阶段 2：无损迁移

- 创建且仅创建五类业务根目录。
- 保留目标侧已有数据，旧数据只补缺，不覆盖现有项目、运行状态和上传文件。
- 拆分混合的旧服务器配置：连接写入 `config/servers.json`，当前选择写入 `config/selection.json`。
- 平台配置归入 `config/providers/` 并保持 `0600`。
- 旧布局和 `~/.elysium` 移入 `runtime/migrations/<timestamp>/`，避免双写源继续存在。

验证：fixture 覆盖冲突保留、配置拆分、凭据权限、旧路径归档和重复执行。

### 阶段 3：构建与运行切换

- 执行插件全量测试、Harness 测试、`pnpm build` 和 `pnpm package:registry`。
- 在本机成功迁移后再重启 Harness，避免新代码读取尚未生成的新配置路径。
- 重启后通过接口及一次真实修改验证界面、接口和磁盘文件一致，且 `~/.elysium` 不再重建。

## 验收标准

- AC-1：数据根一级业务目录只有五类，职责与上表一致。
- AC-2：所有业务路径统一落入五类目录，新增路径不能绕过 `storage-paths.js`。
- AC-3：导演的新增、修改、删除和重载都以 `pools/directors.json` 为唯一事实源。
- AC-4：连接、选择和平台凭据互相独立，位于 `config/`，敏感文件权限为 `0600`。
- AC-5：迁移不覆盖目标侧数据；迁移前后业务文件数量与内容清单一致。
- AC-6：旧路径被归档后不再作为读写源，`~/.elysium` 不会被运行进程重建。
- AC-7：全量测试除已知环境限制外通过，构建和 registry 打包成功。
- AC-8：重启后的界面、接口和磁盘文件一致。

## 当前状态

- 阶段 1～3 全部完成。
- 本机数据已迁移，原有 954 个业务文件清单迁移前后一致；旧写入源已归档到 `runtime/migrations/2026-09-18T02-19-51.872Z/`。
- Harness 已重启；导演接口与 `pools/directors.json` 内容完全一致，访问后 `~/.elysium` 未重建。AC-1～AC-8 通过。
