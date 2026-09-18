# src 整体职责重构

- 类型：新功能
- 目标：在不改变业务行为、工具协议、HTTP 路径和存储格式的前提下，按 Client、Server、Database、Tools、Models、Utils 重组 Elysium 源码。
- 调研来源：用户确认的目标目录与 2026-09-18 源码依赖审计。

## 人工决策

无。用户已确认 `database` 为独立数据模块，`utils` 只承载无业务语义的通用代码。

## 执行步骤

### 阶段 1：界面与后端边界

1. `dsh-elysium/src/client/` — 修改：API 和任务卡散落在视图目录 → `api/`、`workcard/` 独立分包 → AC-1。
2. `dsh-elysium/src/server/` — 新增：原 `http/` 与 `business/` → 路由、领域服务、任务和三类工作流 → AC-1、AC-2。

验证：客户端模块拼接测试、HTTP 路由测试、工具测试 → AC-1、AC-2。

### 阶段 2：数据与通用代码

1. `dsh-elysium/src/database/` — 新增：分散的 JSON、路径和 Store → 统一数据模块及管理器 → AC-3。
2. `dsh-elysium/src/utils/` — 修改：包含 Harness 和存储语义 → 只保留上下文、通用错误和通用校验 → AC-4。
3. `dsh-elysium/src/config.js` — 修改：工具目录中的实例配置 → 根级配置组合 → AC-4。

验证：存储、项目、导演、设置和架构边界测试 → AC-3、AC-4。

### 阶段 3：工具与模型

1. `dsh-elysium/src/tools/` — 修改：工具内包含图片工作流实现 → 只保留 Harness schema、提示词和适配 → AC-2。
2. `dsh-elysium/src/models/` — 新增：原 servers/comfyui → protocols/providers/managers → AC-5。
3. `dsh-elysium/src/server/workflows/images/` — 新增：图片和角色执行逻辑从工具层下沉 → AC-2。

验证：Provider 边界、图片、视频恢复和工具发现测试 → AC-2、AC-5。

### 阶段 4：发布与运行

1. `dsh-elysium/scripts/`、`tests/`、`README.md`、`.claude/standards.md` — 修改：更新构建、引用、结构说明和架构回归测试 → AC-1～AC-6。

验证：`pnpm test`、`pnpm build`、`pnpm package:registry`、Harness 测试、安装重启和 3080 服务身份检查 → AC-6。

## 验收标准

- AC-1：源码一级目录只有 client、server、database、tools、models、utils，入口和配置位于根级。
- AC-2：Harness 工具只位于 tools，业务执行位于 server。
- AC-3：路径、原子 JSON 和各类持久化管理器集中在 database。
- AC-4：utils 不包含业务语义。
- AC-5：模型协议、Provider 与管理器集中在 models。
- AC-6：现有业务测试、构建、发布包和本地 Harness 运行保持通过。

## 验证结果

AC-1～AC-6 全部通过：插件测试 190/190，Harness 测试 10/10，构建、Registry 打包、安装、重启与 3080 身份检查通过。
