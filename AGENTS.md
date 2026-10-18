# AGENTS.md

本文是适用于各类项目的通用开发规范，供 Codex、Cursor、Claude 等 AI 工具使用。只维护请求分类、计划、实施、验证和工具使用流程。

项目名称、源码范围、业务规则、测试命令、运行环境和图谱配置由项目开发指引维护。按请求需要，从项目 README 或工具入口定位指引；未声明时，在 `.agents/` 中查找与当前目标对应的 `*-dev.md`。没有指引时依据源码和配置调研，不假设其他项目的约定适用。

## 请求分类

根据用户要求执行的动作选择流程；打开仓库、提到代码或开发问题，不代表要求修改代码。

| 请求 | 执行方式 |
|---|---|
| 普通咨询 | 直接回答，不要求开发档位、计划、测试或图谱检查。 |
| 项目解释、调研、方案评估 | 按问题读取相关源码和项目指引，必要时查询图谱；保持只读，不自动实施或要求实施记录。 |
| 纯文档修改 | 修改相关正文、链接和入口引用，检查差异；不要求开发计划、业务测试或图谱更新。规范引用和流程提醒文案的同步按此处理。 |
| 代码、配置、skill、测试修改 | 修改前读取本文与适用的项目指引，执行下面的档位、计划、验证和图谱流程。 |

只在当前请求需要理解或修改项目时读取相关指引，不把整份业务文档作为普通咨询的必读材料。

开发采用两步：**调研与计划 → 实施与验证**。完整流程只要求一份计划和一份实施记录；调研结论合入计划，不再单独要求 `docs/research/` 文档，已有调研文档保留作历史线索。小改动只写简短计划，将验证结果回填计划，不另写实施记录。

## 0. 适用范围与档位

修改项目代码、配置、skill 或测试时，先读本文与适用的项目指引，回复开头写明档位及理由：

- **完整流程**：新功能、根因未知的 Bug、数据结构、存储、接口、权限或关键业务流程改动，或涉及至少 3 个文件。
- **小改动**：文案、样式、单处根因明确的修改，且不超过 2 个文件。拿不准按完整流程。

实施前必须已有计划（命名见第 1 节）。计划与实施记录的目录沿用项目约定；没有约定时使用 `docs/plans/` 和 `docs/implement/`。咨询、只读调研和纯文档修改不要求计划；具体源码范围、目录例外和工具拦截条件由项目指引定义。

通用要求：使用中文沟通和撰写文档；只改需求范围内的代码，同步受影响的调用方、测试和文档，不做无关重构；不提交凭据。

## 1. 调研与计划

本步不修改代码，实施前在项目计划目录写好 `{MMDD}-计划-{任务名}.md`。

文件命名：`MMDD` 为计划创建当天的月日（如 `1005-计划-文件导入.md`）；之后修改计划不改文件名。实施记录使用对应计划的日期（如 `1005-实施-文件导入.md`）。

1. **明确规格**：写明一句话目标、非目标和验收标准（AC-1、AC-2…：给定输入/状态 → 可观测结果）。关键要求缺失或无法写出可验证的 AC 时询问用户，不用代码现状反推意图；继续不依赖答案的工作。
2. **取证并判定**：从实际入口追踪调用链，阅读源码、配置、运行产物或官方文档；项目已启用 GitNexus 时按第 4 节定位执行链与影响范围，图谱未覆盖的动态关系以源码补查；未启用时通过源码检索与调用方核对完成调研。已有文档只作线索。每条 AC 标「已确认」（附证据）、「未确认」（列缺口）或「未验收」（需人工验证）。需求歧义或重大决策交用户判断。
3. **形成改动计划**：每条改动写明仓库相对路径、函数或参数、当前 → 目标及对应 AC；同时写验证方法和预期结果。不对应任何 AC 的改动不做。

完整流程模板如下；小改动只保留类型、目标、改动、AC 和验证，不要求调用链与证据表。

```markdown
# {任务名}

- 类型：{新功能 / Bug 修复 / 重构 / 小改动}
- 目标：{一句话}
- 非目标：

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 已确认/未确认/未验收 | 依据或缺口 |
|---|---|---|---|

## 调用链与证据
{入口 → 关键节点 → 问题点 / AC 判定点，含分支和失败路径}

| 来源（文件:行） | 支持的结论 |
|---|---|

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|

## 待用户决定
{没有写「无」}

## 改动
### 阶段 1：{阶段名}
1. `{文件}:{位置}` — {当前 → 目标} → AC-N

验证：{命令或人工步骤} — {预期结果}

## 验证结果
未执行。
```

## 2. 实施与验证

- 用户已提出实施需求时，计划完成后直接执行，不等二次确认；只有用户明确要求只调研、只出方案或等待确认时才停在第一步。
- 按计划逐阶段做最小改动，每阶段完成后运行对应测试，记录实际结果，不用配置或推断代替运行证据。测试与收尾按第 3 节执行。
- 计划与代码不符时，按源码证据补充或修正同一份计划，再继续；不扩大需求范围。
- 只有缺少无法推断的关键信息或需要超出授权时才暂停，说明发现、已完成的改动和需要的决定。
- 完成后核对每条 AC，回填计划的「验证结果」。全部 AC 通过才完成；存在缺陷时返回第一步补证据或调整计划，再实施验证。

完整流程在项目实施记录目录写入 `{MMDD}-实施-{任务名}.md`（日期与对应计划相同）：

```markdown
# {任务名}实施记录

## 已修改文件
- `{文件}` — {改动摘要}

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|

## 测试
{基线与改动后的通过、失败、取消数；新增失败项及原因；未执行的验证明确标注}

## 人工待办
{没有写「无」}
```

## 3. 测试与收尾

- 按项目指引确定测试命令与范围，改动前记录适用的基线，每阶段运行相关测试；是否运行全量测试以项目要求和影响范围为准。相关测试必须通过，比较基线时不得新增失败，同时检查通过、失败与 cancelled 数。
- 新功能或修复按风险补充必要测试；低风险、可逆的文案与样式修改可直接验证实际效果，不编写仅复述实现的测试。无法执行时说明原因并标「未验证」。纯文档修改检查内容、链接与差异，不要求业务测试。
- 收尾运行 `git diff --check`，检查本次差异无无关改动或凭据，不覆盖工作区已有修改。
- 已通过的检查不无故重复或扩大；出现新改动、失败或未解决问题时再补测。项目已启用 GitNexus 时，代码修改完成后按第 4 节更新索引。

## 4. GitNexus 代码图谱

- 项目已启用 GitNexus 时执行本节；优先使用已配置的 MCP，不可用时使用本机 CLI。仓库标识、索引目录和索引命令从项目指引读取，未启用的项目不强制安装。
- 修改代码前先执行 `gitnexus status`；索引缺失或过期时先按项目指引更新。用户明确要求配置或刷新图谱时也执行。
- 项目代码调研时，按问题需要用 `gitnexus query "任务关键词" -r <仓库名>` 定位执行链，再用 `gitnexus context <符号名> -f <仓库相对文件路径> -r <仓库名>` 核对调用方与被调用方，并阅读实际源码。
- 修改目标确定后，用 `gitnexus impact <符号名> -f <仓库相对文件路径> -d upstream --include-tests -r <仓库名>` 评估调用方、受影响流程及测试，结论写入本任务计划。动态分派、插件注册等图谱未覆盖的关系需通过源码补查，不把无结果视为无影响。
- 修改后先执行 `gitnexus detect-changes --scope all -r <仓库名>` 对照计划检查实际影响，再完成第 3 节的验证。文档修改不要求业务测试。
- 完成代码修改及验证后，在最终回复前按项目指引更新索引；同一任务集中更新一次，不在每次编辑后重复执行。
- 普通咨询和纯文档修改不要求图谱检查或更新；只读调研且索引有效时不更新。更新失败时说明原因与索引可能过期，不宣称更新成功；不为修复索引问题修改无关业务代码。

## 5. AI 工具入口与流程提醒

通用流程维护于 `AGENTS.md`，项目业务与工具配置维护于项目开发指引，避免重复正文。

- 全局指令只保存个人通用要求，不写入特定项目的路径、测试命令或业务规则。
- 不同工具的入口引用同一份规范；需要副入口时优先引用或符号链接，具体布局由项目指引记录。
- 项目有流程钩子时，提醒与拦截范围须与项目指引一致；普通咨询、只读调研和纯文档修改不触发代码开发要求。
- 工具不可用或钩子未安装时仍按本文与项目指引执行，不声称已经运行未实际存在的自动检查。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **meiji-harness** (6282 symbols, 19832 relationships, 360 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/meiji-harness/context` | Codebase overview, check index freshness |
| `gitnexus://repo/meiji-harness/clusters` | All functional areas |
| `gitnexus://repo/meiji-harness/processes` | All execution flows |
| `gitnexus://repo/meiji-harness/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
