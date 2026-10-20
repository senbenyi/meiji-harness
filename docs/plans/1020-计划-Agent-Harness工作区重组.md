# Agent Harness 工作区重组

- 类型：重构，完整流程。
- 目标：将当前 meiji-harness 更名为 agent-harness，公共代码放 packages，业务代码放 projects，复制仓库后主要修改 projects 即可开发其他 Agent。
- 非目标：修改 meiji 业务规则、任务/项目/步骤 JSON 字段、SQLite schema、供应商密钥、meiji-server、上游 Harness 源码、远端 Git 仓库名称或提交历史；不启动生产服务。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 调研状态 | 依据/缺口 |
|---|---|---|---|
| AC-1 | 打开新仓库 → projects/meiji 和 packages/{http-client,prompt-composer} 为实际源码位置 | 未验收 | 原代码 meiji/，公共包位于并列 agent-modules |
| AC-2 | 根 npm ci → 所有工作区安装成功，业务通过包名引用公共源码，单一根锁文件 | 未验收 | 原 file:../../agent-modules 必须改为 npm workspace 本地匹配版本 |
| AC-3 | 根 npm test / 独立打包安装 → 业务、公共模块及隔离示例全部通过 | 基线已确认 | meiji 674 pass；公共模块 24 pass；0 fail/cancelled |
| AC-4 | 安装/重启脚本选择 projects 中项目 → 解析正确插件入口与包名；错误选择/外来进程拒绝 | 未验收 | 两脚本写死 meiji，runtime.test.js 固定仓库深度 |
| AC-5 | 仓库换到另一临时目录 npm ci → 示例与项目入口能使用，不依赖旧绝对路径/并列 agent-modules | 未验收 | 需复制仓库冒烟；业务 ID/API/存储路径保持原样 |
| AC-6 | 本机已安装 meiji → profile 插件链接指向新项目，配置解析正常 | 已确认旧路径，待改后验收 | ~/.dsh/profiles/web 的依赖与符号链接指向旧目录；当前3080无监听 |
| AC-7 | 开发与历史资料 → 活跃文档和工具指向新路径，已有未提交修改、忽略文件和公共仓库元数据保留 | 未验收 | 原仓库有前序任务未提交变更；agent-modules为尚无提交的独立本地仓库 |
| AC-8 | 任意新 Agent 独立安装公共包 → 无 meiji 历史兼容分支，文本模型不限定为 meiji 的选项 | 用户执行中明确，待验收 | 公共 HTTP 包含旧 Elysium 分支、priorTrace旧快照及两个文本模型白名单，需清理 |

## 调用链与证据

- configure-harness.sh → plugin CLI add 路径 → 项目 package.json 的 dsh.bundle.patch → index.js/session.js → runtime 与静态资源（内部使用 import.meta.url，相对项目根不变）。
- restart-harness.sh → profile bundle 与包符号链接核验 → 所有端口进程归属核验 → TERM/等待 → 启动；保留全部安全边界。
- runtime.test.js:215 起相对路径依赖旧目录深度，需更新测试夹具的项目位置。
- .claude/guard.mjs 对 meiji/ 做开发计划检查，重组后应覆盖 packages/ 和 projects/，纯文档仍豁免。
- Graph context/impact：插件 apply 为动态注册入口，UNKNOWN 不是未使用，已用 package.json/cordis.patch.yml/会话测试补查。registerTaskPanel 直接调用方为 index.apply。guard 源码未被图谱覆盖，以实际配置引用及子进程测试补查。
- 工作区迁移以文件清单和 SHA256 核对，避免移动大量文件掩盖前序未提交内容。

## 待用户决定
无。用户已确认整体仓库改名、packages/projects 两部分及复制复用方式。

## 改动
### 阶段1：保全与目录迁移
1. 保存文件内容/符号链接清单与原 dirty 状态；将原 agent-modules 完整归档至用户 Codex backups，保留其独立 .git 与忽略文件。
2. 原仓库目录改为 agent-harness，meiji/ 整体移至 projects/meiji；minimax-h3 业务参考资料移入项目 references；根部业务参考文档移入项目 docs/reference。
3. 从归档公共仓库复制 packages、示例、包安装验证脚本；不引入嵌套 .git。旧项目 node_modules/子锁文件/.npmrc 归档，根锁文件统一管理。

### 阶段2：工作区与通用入口
1. 新建根 package.json：workspaces=packages/*、projects/*，统一 test、example、verify:install、configure、restart。
2. projects/meiji/package.json 的公共依赖改为本工作区匹配版本，npm 使用实际本地链接；公共代码仍支持 tarball 分发。
3. 根 scripts/project-path.sh 自动选择唯一项目或接受参数/AGENT_PROJECT；configure/restart 引用项目路径和其 package.name，不硬编码 meiji。
4. runtime.test.js 调整测试路径，新增工程入口测试：多项目选择、非法路径、重启预检和开发钩子正确覆盖。

### 阶段3：规范与链接
1. 项目业务指引移入 projects/meiji/.agents；项目 AGENTS 链接根规范与业务指引，根 .agents/agent-harness-dev.md 只维护通用工作区约定。
2. 更新活跃 README、开发规范、测试说明、.claude 钩子及 symlink；历史计划/实施原路径作为历史证据保留，不批量改写正文。
3. 备份并只更新本机 web profile 的 meiji 依赖和符号链接（及相关锁文件中的旧插件位置），不改变其他插件配置、不修改数据库、不启动服务。

### 阶段4：验收
1. npm ci、根 npm test、包隔离打包安装、真实复制目录安装/入口冒烟、shell语法和钩子验证。
2. 文件清单差异、业务源文件 SHA256、相对导入/符号链接/活跃文档链接、git diff --check。
3. 新路径刷新 GitNexus，按新仓库绑定执行 detect_changes；大量移入的文件用清单补核，不把未追踪路径或图谱缺失视为无影响。

### 用户明确后的公共包简化
用户进一步明确：meiji 接入兼容不是当前优先项，packages 必须独立且不承担 meiji 的复杂历史逻辑。因此旧 Elysium 媒体实现退出公共包，暂放回 projects/meiji 的 legacy 区供后续业务重构处理；删除对应公共 exports/分发验证，不再将旧适配当作公共能力。公共客户端去除 priorTrace 历史记录注入，文本接受任意非空模型名，保留服务真实 HTTP 状态；业务规则/任务状态仍不进入公共包。图片/视频当前服务协议及异步请求恢复继续作为可独立调用的公共能力保留 → AC-8。

验证：任意文本模型透传与真实状态回归、现有公共测试、tarball 不再导出/包含旧 Elysium 模块、复制安装验证。meiji 的大规模重构仍不在本次实施范围，不为兼容业务增加新的公共分支。

## 验证结果
- 基线：meiji 674 pass；公共模块24 pass；均0 fail/0 cancelled/0 skipped。
- 工作区重组后：meiji674、公共模块24、工程入口6，共704通过，0失败/取消/跳过。
- 按用户后续要求简化公共包后：公共模块25通过（删除1项已退役 Elysium 公共能力测试，增加任意模型透传与真实HTTP状态2项），meiji674仍通过；工程入口6通过。最终合计705通过，无失败/取消/跳过。
- 根 npm ci、shell/node语法、公共包tarball隔离安装、复制目录改业务目录/包名后离线安装、插件入口与工程测试均通过。
- 公共HTTP源代码由956行减少至435行，旧网关521行退出公共包；tarball检查不包含elysium目录，旧公共导出明确不存在。源码无meiji、priorTrace或业务节点/步骤依赖。
- 文件SHA256校对：初次迁移505个既有文件未变；其余变化限于路径、工作区、工具/测试入口和文档；公共包原始状态完整备份，业务源代码只对接回项目自身legacy，不改变业务数据/字段。
- 宿主 profile 依赖与插件符号链接已更新为 projects/meiji，并实际解析验证。未启动/重启生产服务。
- 新路径GitNexus完成全量重建并注册别名agent-harness。整目录迁移全量检测4825个符号，整体CRITICAL且列表截断，未当作干净检查；使用临时Git index分32组覆盖581个变化路径复检，每组partial=false、truncated=false，真实Git index SHA256未变。
- git diff --check、有效符号链接、活跃文档链接检查通过；最终文档完成后再次集中刷新索引。

| AC | 验收 | 依据 |
|---|---|---|
| AC-1 | 通过 | 新根目录与packages/projects实际源码位置；旧两个目录已退出工作区 |
| AC-2 | 通过 | 根npm ci；本地realpath链接；根唯一锁文件 |
| AC-3 | 通过 | 最终25公共测试+674项目测试+6工程测试；隔离tarball示例 |
| AC-4 | 通过 | 唯一/多项目选择、非法目录拒绝及原restart成功/外来进程/拒绝退出用例 |
| AC-5 | 通过 | 临时复制目录，修改项目名、目录，自动更新锁文件再离线npm ci与入口/示例/工程测试 |
| AC-6 | 通过 | profile JSON与符号链接实查，未改变其他插件 |
| AC-7 | 通过 | 内容清单、完整备份、业务指引项目内维护、有效相对链接；未提交原有变更 |
| AC-8 | 通过 | 旧网关不导出不分发；任意文本模型透传、真实HTTP状态、独立包测试和源码边界检查 |
