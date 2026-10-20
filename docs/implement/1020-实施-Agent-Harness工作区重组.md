# Agent Harness 工作区重组实施记录

对应[计划](../plans/1020-计划-Agent-Harness工作区重组.md)。

## 结果与最终边界

- 仓库从 `/Users/devin/meiji/meiji-harness` 移到 `/Users/devin/meiji/agent-harness`，原Git历史、远端与未提交修改保留。
- `projects/meiji` 包含原业务插件；业务规则、任务系统、数据模型、界面与数据根保持原业务身份。
- `packages/http-client`、`packages/prompt-composer` 为独立公共包，npm workspaces 本地链接，无跨仓库file依赖和副本同步。
- 按用户执行中明确的优先级，公共包不为meiji历史接入提供复杂兼容。旧Elysium代码从公共包移回 `projects/meiji/server/http/elysium/legacy`，没有导出或分发；后续由meiji业务重构处理。
- 真实供应商密钥仍由meiji-server管理，宿主deepseek-harness与模型服务源码未修改。

## 已修改文件

### 工作区与入口

- 根 `package.json`、`package-lock.json`：workspaces覆盖packages/projects，统一安装、测试、示例、打包验证与复制验证命令。
- `projects/meiji/package.json`：公共包改用匹配工作区版本；原子锁文件、复制安装.npmrc和node_modules已归档，不进入新工作区。
- `scripts/project-path.sh`：唯一项目自动选择、多项目参数/AGENT_PROJECT选择，拒绝非法路径。
- `configure-harness.sh`：以projects下所选项目为插件路径；可自动安装根工作区依赖。
- `restart-harness.sh`：从项目package.json读取包名；保留profile链接核验、端口进程归属核验、正常停止/等待的边界。
- `scripts/tests/workspace.test.js`：6项项目选择、边界、链接、入口和开发钩子测试。
- `scripts/verify-copy.js`：临时复制，修改业务目录和包名，离线安装与本地链接/入口/示例/工程测试，根脚本不改。
- `scripts/verify-install.js`、`examples/minimal-agent.js`：并入根工程，独立打包验证增加旧网关不得分发/导出的检查。

### 公共包简化

- 从公共HTTP包移出 `src/elysium/{gateway,media,video-params}.js` 共521行旧代码，公共源代码由956行减至435行。
- HTTP package.json删除旧Elysium子入口；独立包测试删除已退出公共契约的1项旧网关测试，其业务回归仍在项目测试中。
- `src/llm-server/client.js`：删除priorTrace旧请求快照注入，恢复仅按显式请求ID/原地址；透传调用方超时。
- `src/llm-server/params.js`：文本模型只要求非空，不限定meiji选项；图片和视频保留实际服务协议要求，不包含业务规则。
- `src/chat.js`和图片调用：保留真实HTTP错误状态，移除旧业务网关状态映射。
- 新增任意Agent文本模型及真实HTTP状态2项回归。公共包仅通过请求参数、显式标识与record回调交互，不读取业务项目或任务对象。
- `projects/meiji/server/gateway/model-gateway.js`与`server/http/elysium/video-params.js`只改回项目legacy导入，公共包不承担该兼容层。

### 资料与工具

- 根README、`.agents/agent-harness-dev.md`说明两部分职责、复制方法、通用命令和外部宿主。
- meiji业务指引移入项目 `.agents`，新增项目AGENTS；更新项目README、测试文档和因迁移改变的相对链接。
- `.claude/guard.mjs`覆盖packages/projects/工程脚本，纯文档豁免；工具副入口改为通用agent-harness-dev链接，Cursor规则改为project-contracts。
- 原根业务参考文档移到项目docs/reference；minimax-h3参考资料移到项目references。
- 历史计划的旧路径保留作追溯，只有一处跨目录Markdown链接作机械重定位。
- `.gitignore`按projects通配忽略报告和本地模型配置。

## 验收与测试

| 检查 | 结果 |
|---|---|
| 基线项目测试 | 674通过，0失败/取消/跳过 |
| 基线公共包 | 24通过，0失败/取消/跳过 |
| 重组后全量 | 704通过：674项目+24公共+6工程 |
| 用户明确公共包简化后的最终公共包 | 25通过：21 HTTP+4编排，0失败/取消/跳过 |
| 简化后项目回归 | 674通过，0失败/取消/跳过；未为兼容它增加公共分支 |
| 最终工程入口 | 6通过，复制目录内同样通过 |
| npm ci及工作区链接 | 通过，包realpath位于本仓库packages |
| tarball隔离安装 | 通过，无原工作区路径依赖，无旧Elysium公共代码 |
| 复制改名再安装 | 通过，业务目录/包名可变化，根脚本不改 |
| shell/node语法、diff空白、活跃文档链接及符号链接 | 通过 |

测试使用本机模拟HTTP与临时媒体文件，未请求真实模型。最终各测试组共705通过，无新增失败或取消。

## 文件保全与宿主

- 原agent-modules完整状态（含.git与忽略文件）、meiji旧依赖安装文件及旧路径本地索引保存在 `/Users/devin/.codex/backups/agent-harness-layout-20261020-164517`。
- 迁移前文件清单与SHA256核对无丢失；初次迁移505个既有文件完全不变，改动文件逐项归属工程入口、测试、路径和文档。随后公共包清理按用户明确要求执行，原版本仍在备份内。
- web profile的meiji依赖与符号链接已指向新路径，对应package.json/锁文件及旧链接目标已备份；没有修改其他插件。
- 未改项目数据库、业务持久化字段或模型服务凭据；未启动/重启生产服务。

## 图谱

新路径索引注册为agent-harness。整目录迁移会将大量删除/新增映射为4825个变化符号，整体风险CRITICAL、列表截断，该结果未作为干净检查。随后用临时Git index按32组覆盖581个变化路径，每组partial=false、truncated=false；真实Git index的SHA256保持不变，没有暂存用户文件或创建提交。

图谱的流程枚举有自身分支预算，移动文件的语义保持还由内容哈希与实际测试验证，不将未列出流程视为不受影响。最终文档完成后集中刷新新路径索引。

## 后续边界

meiji本身的业务重构和任务系统提取留待后续；当前公共包的验收以独立测试、独立安装和清晰边界为准。所有改动仍在本地工作区，未提交、推送或发布包。远端仓库地址沿用原地址，未执行远端改名。
