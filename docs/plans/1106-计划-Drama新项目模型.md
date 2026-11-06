# Drama 新项目模型

- 类型：数据结构
- 目标：以 `projects/drama/docs/data/a_drama_detail.json` 及节点草案实现独立的新模型 Schema、初始化和校验。
- 非目标：本次不接入制作执行器、存储、面板，不迁移旧数据，不读取文档作为运行模板。用户已明确确认此边界。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 调研状态 | 依据 |
|---|---|---|---|
| AC-1 | 新建模型 → 顶层仅 id/title/aspect_ratio/origin_script/data，九节点按草案排列 | 已确认 | a_drama_detail.json |
| AC-2 | 节点产物 → 保留草案各层包装及字段，节点 id/type 固定，严格拒绝旧字段与额外字段 | 已确认 | docs/data 下八个现有节点文件；editing 节点内 id 按草案为 editing，外层 key 为 video_editing |
| AC-3 | 核心资产缺图、镜头临时资产、非核心说话人 → 可保存；重复 ID、悬空引用、错镜头节拍、非法生成模式/时长 → 拒绝 | 已确认 | 开发规范.md 与运行模型现有约束 |
| AC-4 | 新模型构建/校验 → 不修改输入，校验错误含路径，不改变现有 V4 API 行为 | 已确认 | 用户确认暂不接入运行链 |

## 调用链与证据
当前入口 `src/index.js` → V4 `drama_document.js` → Store / Workspace / Executor。本次增加并公开独立 `drama_model.js` API，不把新结构传入 V4 Store。

图谱仓库与工作目录：`/Users/devin/meiji/agent-harness`，MCP 注册名 meiji-harness；索引已从 a094591 更新到当前 0479771。query/context/impact（MCP 与本地 CLI）对 createProjectDocument 和 src/index.js 均未找到，风险 UNKNOWN，不代表无人使用。源码补查确认 V4 内部从 drama_document.js 直接导入；src/index.js 由 package.json 的 ./project 公开，新增导出不修改已有导出或函数。新文件尚无调用方。最终再检查 detect-changes 和更新索引。

## 设计缺口与处理
- `delivery.json`、`drama_detail_shared.json` 不存在；交付节点暂以现有 episodes/delivery 产物形状定义，状态、imageReference、voiceReference 采用现有明确字段，写入 Schema 注释说明。
- story_segments 草案没有 sequence 字段，按数组顺序保存，不擅自增加 sequence。
- 临时资产 id、所有 image_id 允许 null；核心资产 id 非空。speaker_id 允许 null，speaker_name 必填，已提供 id 时须引用核心人物或当前镜头人物。
- 图片是否实际存在及文件是否可读需要存储上下文，本次结构校验只验证引用格式；外部资源存在性留给后续接入层。
- 不新增 revision、basic_info、source 等旧顶层字段。

## 改动
1. `projects/drama/src/drama_runtime/drama_model.js`：独立 Schema、空模型工厂与结构/内部引用校验 → AC-1～4。
2. `projects/drama/src/index.js`：新增新模型命名导出，保留已有 API → AC-4。
3. `projects/drama/tests/drama-model.test.js`：结构对照、全链路引用及负面边界 → AC-1～4。
4. 更新项目入口与开发规范，明确模型定义已完成而运行接入未实施。

验证：基线及改后 `npm run test:drama`，新增模型定向测试，`git diff --check`，图谱 detect-changes / analyze --index-only。

## 验证结果
- AC-1～4：通过新增 `drama-model.test.js` 6项测试；对八份已提供节点草案逐层比对字段，使用完整跨阶段产物覆盖正向、负向引用与三种模式。
- 基线 `npm run test:drama`：279项，277通过、2失败、0取消。改后：285项，283通过、2失败、0取消。两项失败均为既有文档缺失：`projects/drama/docs/drama_v4.example.json`、`projects/drama/docs/drama_detail.json`；不在本次模型定义范围内补造旧文档。
- `npm run verify:copy -- drama`：通过。
- `git diff --check`：通过。
- 图谱初始MCP结果包含陈旧的“session入口迁移”符号并误报critical，与本地CLI不一致；最终 `analyze --force --index-only` 成功重建为10,385节点、26,003边后重查，detect-changes风险low，3个已跟踪文件、3个文档符号、0受影响流程，无partial/truncated标志。未跟踪新文件不在git diff范围，已单独核对源码/测试并被索引收录；createDramaModel impact为LOW，直接调用方仅新测试empty，累计3个测试符号。
- 索引构建仍报告执行流程抽样预算限制，不把未列出的流程视为不存在；本次同时以源码导入检索和现有V4测试核对接入边界。
