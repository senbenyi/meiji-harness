# 开发规范

修改 meiji 代码时必须遵守本文件。目录与模块说明见 `architecture.md`。

## 1. 流程

凡修改 `meiji/` 下代码、配置、skill 或测试（`meiji/docs/`、`meiji/reports/` 除外）：

1. 先读 `architecture.md` 与本文件。
2. 在回复开头写明「档位：完整流程 / 小改动」及理由：
   - **完整流程**：新功能；根因未知的 Bug；数据结构、存储、接口、门禁、生成流程改动；涉及 3 个以上文件。
   - **小改动**：文案、样式、单处明确且根因已知的修改，涉及不超过 2 个文件。
   - 拿不准时按完整流程。
3. 完整流程：调研（第 6 节）→ 计划（第 7 节）→ 实施（第 8 节）。小改动：跳过调研，写简短计划后实施，不写实施记录。
4. 没有 `docs/plans/计划-*.md` 不得修改 `meiji/` 代码。只回答问题、只做调研或只改文档时不需要计划。

## 2. 编码规则

- 新代码放进 `architecture.md` 第 2 节对应目录。
- `index.js` 是唯一组合入口。
- 依赖只能从高层指向低层：`http/tools → flow → generate → prompts → data → models`；`server/host`、`shared` 可被任意服务端层引用。由 `tests/architecture.test.js` 强制。
- `client/`、`shared/` 只放 `.js` / `.css`，且必须平铺（`resolveClientFile` 拒绝子路径）；不引入 JSX、bundler 或构建步骤。
- 前后端共用的模块放 `shared/`：必须浏览器与 Node 通用，不得引用 `node:` 模块或 `client/`、`server/`；服务端、工具与脚本不得引用 `client/`。
- 访问 Harness 只经 `server/host/`，且只用公开接口（如 `ctx.workspaceRegistry`）；不读取 Harness 的存储文件。
- 新增面板操作：在 `server/flow/operations/` 对应领域文件注册 `{ stage, run }`，并在 `registry.js` 的 `definitions` 登记 `label / scope / queue / agent`，以及步骤计划 `plan`（处理函数经 `runStep` 执行）或单步 `step`；不在入口 `operations/run.js` 里加分支。
- 文件按内容命名，不按历史事件或临时来源命名；一次性迁移脚本统一 `migrate-` 前缀；测试文件与被测模块或主题同名。
- `tools/` 只调用 `server/data` 与 `server/flow`；会话与面板共用 `server/flow/tasks/runner.js` 与 `runOperation`，不另建生成通路。
- 技能写法（详见 `skills/README.md`）：
  - 阶段技能放 `skills/constraints/stages/<id>/`：`skill.json` + 按字段的 Markdown（`common` 通用、`generate` 生成、`review` 验收标准、`revise` 修订边界、`protocol` 输出协议）。md 文件与 `fields` 一致，结构错误由 `validateSkills` 与 `tests/skill.test.js` 报出。
  - 固定约束只放 `skills/constraints/<id>.md`，阶段通过 `fixedConstraints: true` 显式启用；只有固定约束的阶段允许 `fields: []`，不再有 generate.md。空约束文件表示不注入约束，不能回退到 JS 默认值；缺文件仍报错。固定约束参与任务快照和哈希，不允许页面/API/基础覆盖/本剧补充修改；实际生成与预览从同一来源读取。
  - 程序解析依赖的格式（JSON 字段、`## S01 / 5s`、`[seconds-complete]`、`[opening-reference: …]`、PASS/FAIL）只写在 `protocol.md` 或代码里；面板不能修改协议。
  - 多个阶段共用的段落写成 `skills/constraints/shared/<id>.md`，由 `skill.json` 的 `shared` 按字段引用，不复制到各阶段。
  - 动作、武术、台词、表情、声音规则写在 `skills/constraints/guidance/<id>/`（`common`、`review`、`stages/<阶段>.md`），不写进阶段技能；指导只细化上游已有内容。
  - 流程说明（谁发请求、失败后是否重试）由代码负责，不写进技能正文。
  - 各生成接口在 `server/prompts/interfaces/<阶段>.js` 独立定义 system/user/prompt 的内容、顺序与输出格式；公共分发与网络层不得追加统一提示词包装。`skill-prompts.js` 仅提供可选技能片段与来源标注，不决定最终结构。新增阶段须登记 `skill.json` 与对应接口模块；技能正文仍从技能组合读取，预览必须复用实际接口组装函数，不在流程或网络层另拼提示词。修改输出协议时须同步其解析与校验，不能只更改 json 标记。
  - Harness 只注册 `skills/agent/panel.md`（会话 agent 使用）；生成技能不注册。
  - 改动技能正文后运行 `node tests/fixtures/prompt-scenarios.js <after.json>` 与 `node scripts/prompt-diff.js <before.json> <after.json> <报告.md>`，核对删除的句子都有去向或理由。
- 技能修改（基础层、本剧补充、指导开关与素材）只经面板接口（同源请求）；会话工具不提供修改技能的能力。
- `h3skill/` 保持官方原文，不混入本地改写。
- 只改需求范围内的代码；受改动影响的调用方、测试和文档一并修改，并写入计划。不做与需求无关的重构。

- 任务状态只由步骤推导（`shared/steps.js` 的 `deriveTaskStatus`），任何代码不直接给任务状态赋值；步骤状态只经执行器（`task-store.js` 的 `runStep`、`finalizeSteps`）修改。
- 生成、审核等工作以步骤执行：文本用 `text-steps.js` 的 `runTextSteps` / `generateStep` / `reviewStep`，其他用 `runStep(kind, run, { target })`；`target` 与操作计划中的步骤一致，计划外步骤会标 `unplanned`。
- 人工专属操作（忽略自审、确认图片、编辑与删除）在操作定义中 `agent: false`，会话工具不能发起；新增此类操作同样登记。

## 3. 数据规则

- JSON 写入一律临时文件 + `rename` 原子替换，权限 `0600`；素材导入先写 `.upload/` 再重命名。
- 项目读写只经 `projectStore`（领域存储）；存储布局（索引 + 每集文件）只由 `server/data/project-files.js` 了解，其他代码不得直接读写项目文件。
- 项目保存经 `projectStore.save` 按 `revision` 串行提交；只重写内容变化的剧集，最后原子替换索引。
- 数据结构为 `schemaVersion: 2`、存储布局为 `layout: 2`、任务记录为 `schemaVersion: 2`（`steps`），运行时拒绝旧结构、旧布局与旧任务记录；结构或布局变更必须提供 `scripts/` 迁移脚本（先完整备份、迁移后读回核对），不写运行时兼容。
- 摘要、大纲、人物、场景的补充 skill 按集按节点保存到 `supplementalSkills`；任务开始时冻结，节点编辑只影响后续任务。其他阶段的项目补充及指导素材暂保存在项目索引 `skills`，剧集中不得出现 `customSkills` / `guidanceAssets`（运行时拒绝，由 `scripts/migrate-custom-skills.js` 迁移）；技能基础修改层只经 `server/data/skill-store.js` 读写 `storages/meiji/skills/`。
- 生成图片先进 `image-drafts/`，只有用户“确认使用”后才入素材库；模型工具不能自动批准。
- 重新生成创建新素材，不覆盖旧素材；参考图变化后视频与合成结果标记 `stale`。
- 面板写请求必须携带 `operationId` 并校验会话；多集操作必须带 `episodeId`。
- 密钥不得写入 git 跟踪的文件（含 `config/models.json`），只放 `config/models.local.json`（git 忽略，覆盖 `models.json` 同名字段）或运行时 `storages/meiji/models.json`；不返回浏览器，不写入日志或文档。

## 4. 测试

- 运行：`cd meiji && npm test`（固定使用 `tests/fixtures/models.local.json` 的测试密钥，不读取真实密钥；UI 测试从同级 `deepseek-harness` 或 `HARNESS_DIR` 加载 jsdom）。
- 核对结果时同时看通过、失败与取消（cancelled）数：测试挂起会以「取消」出现而非失败。
- 新增功能或修复必须有对应测试。
- 改动前先跑一次记下基线失败项；改动后与改动相关的测试必须通过，且不得新增失败。无法运行时说明原因并标「未验证」。
- 提交前 `git diff --check`，确认无无关修改或凭据。

## 5. 铁律

- 不修改上游 Harness 源码；接入只通过插件与 `cordis.patch.yml`。
- 制作顺序由 `shared/gates.js` 门禁决定，不绕过门禁直接生成下游。
- 审核失败保留生成内容与意见，不回退；接口或格式错误不覆盖旧内容。人工可忽略自审（只对当前版本、不可忽略格式错误、只在面板操作）。
- 网关不提供取消接口：停止、服务关闭与重启只取消本地任务，如实记录远端任务 ID 可能仍在运行，不宣称已取消；不续查、不自动恢复；重试一律重新提交。
- 网关不提供文件接口：图片以本地文件为准（`localPath` / `assetId`），参考图只在提交视频时读取本地图片、按 `<Picture N>` 顺序转为 base64 data URL；文本请求不传图片。
- 生成任务经全局队列限流，并发上限在 `config/models.json` 的 `concurrency` 配置。

## 6. 调研

调研不修改业务代码。

1. **明确规格**：目标（一句话）、非目标、验收标准（AC-1、AC-2…：给定输入/状态 → 可观测结果）。关键要求缺失或无法写出可验证的 AC 时先问用户，不用代码现状反推意图。
2. **取证**：从实际入口追踪调用链，到能定位问题或确认 AC 为止。证据必须是实际读取的源码、配置、运行产物或官方文档；已有调研/计划/实施文档只作线索。
3. **判定**：每条 AC 标「已确认」（注明证据）、「未确认」（列出缺口）或「未验收」（需人工验证）；需求歧义或重大决策交用户判断。

写入 `docs/research/调研-{任务名}.md`：

```markdown
# {任务名}调研

## 结论
{逐 AC 一行：AC-N — 已确认/未确认/未验收 — 依据}

## 规格
- 目标：
- 非目标：
- 验收标准：

## 调用链
{入口 → 关键节点 → 问题点 / AC 判定点，含分支和失败路径}

## 证据
| 来源（文件:行） | 支持的结论 |
|---|---|

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|

## 待用户决定
{没有写「无」}
```

## 7. 计划

完整流程基于本任务的调研文档；调研缺少 AC 时先补调研。小改动直接在计划中写目标、AC 和验证。

每条改动写明：文件路径（相对仓库根）、位置（函数/参数）、当前 → 目标、对应 AC。不对应任何 AC 的改动不做。

写入 `docs/plans/计划-{任务名}.md`：

```markdown
# {任务名}

- 类型：{新功能 / Bug 修复 / 重构 / 小改动}
- 目标：{一句话}
- 调研：{调研文档路径；小改动写「无」}

## 待用户决定
{没有写「无」}

## 改动
### 阶段 1：{阶段名}
1. `{文件}:{位置}` — {当前 → 目标} → AC-N

验证：{命令或人工步骤} — {预期结果}

## 验收标准
{AC 列表}

## 验证结果
未执行。
```

## 8. 实施

- 用户已提出实施需求时直接开始，不等二次确认。
- 按计划逐阶段做最小改动，每阶段完成后立即运行测试获取实际结果，不用配置或推断代替运行证据。
- 计划与代码不符（方法不存在、调用方遗漏、需调整字段）时，按代码证据修正计划后继续；不扩大需求范围。
- 只有缺少无法推断的关键信息或需要超出授权时才暂停，并说明发现、已完成的改动和需要的决定。

完整流程写入 `docs/implement/实施-{任务名}.md`：

```markdown
# {任务名}实施记录

## 已修改文件
- `{文件}` — {改动摘要}

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|

## 测试
{npm test 结果：基线失败 N 项，改动后失败 M 项}

## 人工待办
{没有写「无」}
```

收尾：更新计划的「验证结果」；全部 AC 通过即完成，存在缺陷时根因未确认回调研、方案明确回计划。
