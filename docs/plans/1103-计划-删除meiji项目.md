# 删除meiji项目

- 类型：完整流程，删除业务工作区及配置入口。
- 目标：移除projects/meiji，保留drama与公共包可运行。
- 非目标：删除运行数据、外部宿主、历史文档或已有drama未提交改动。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 仓库目录与npm工作区 → 不再存在meiji工作区及其链接 | 已确认待实施 | 项目264个已跟踪文件，无本地改动/未跟踪文件 |
| AC-2 | 有效开发入口 → 指向仍存在的drama项目 | 已确认待实施 | .agents/agent-harness-dev.md、.cursor/rules/project-contracts.mdc |
| AC-3 | 根测试与复制验收 → drama、公共包及工程测试通过，不新增失败 | 未验收 | 基线执行中 |

## 调用链与证据
根package.json通配projects/* → package-lock工作区记录 → configure/restart及verify-copy通过project-path选择项目。其他项目未发现导入/运行读取meiji源码的关系。
GitNexus status有效；index.js及package.json的impact返回UNKNOWN，未作为安全结论；rg核实唯一有效外部引用为锁文件和两处开发入口。drama内复制来源注释及历史docs保留，不属于运行依赖。

## 待用户决定
无，用户明确授权删除并要求继续。

## 改动
1. 删除projects/meiji/全部内容 → AC-1。
2. npm更新根package-lock.json并清理本地失效工作区链接 → AC-1。
3. .agents/agent-harness-dev.md、.cursor/rules/project-contracts.mdc当前入口指向drama → AC-2。

验证：根npm test基线/改后对比；npm run verify:copy（唯一项目自动选择drama）；入口与依赖链接检查、git diff --check、图谱变化检查及集中索引更新 → AC-1/2/3。

## 验证结果
- 基线npm test：1000通过、0失败、0取消、0跳过，其中meiji671项。
- 删除后npm test：329通过、0失败、0取消、0跳过；保留工作区公共包143项、工程7项、drama179项，无新增失败。
- npm run verify:copy通过：唯一项目自动选择drama，不同目录/更名、离线安装、公共包链接和插件导入均通过。锁文件最终仅移除meiji与独占playwright依赖，排除npm自动产生的无关平台元数据变化。
- AC-1通过：projects/meiji及node_modules/@meiji/harness-plugin不存在，锁文件不含meiji工作区。
- AC-2通过：两处有效入口指向现存drama/AGENTS.md，历史文档与来源注释保留。
- AC-3通过：测试及复制验收通过，上一轮drama改动完整保留，运行数据未修改。
- 最终图谱detect-changes：269文件、420符号、620流程，critical风险；原始结构化结果符号420项、流程620项均完整，无partial/truncated。该all范围包含工作区既有改动，不将全部变化归因于本任务。已告知critical风险并以目录外引用、锁文件、根测试及复制验收补证；未用零调用或共享轴降级。
- 索引更新成功：17799节点、181300边、512流程；已移除删除项目的代码图谱。git diff --check通过，无无关业务改动或凭据。
