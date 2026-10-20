# drama运行时定义与提示词实施记录

## 已修改文件
- `projects/drama/src/project/node_definitions.js`：6类文本AI节点、统一审核与图片媒体契约；字段类型、基本含义、必填、枚举、数值范围、数组容量与模式互斥的唯一运行时定义。
- `projects/drama/src/project/node_output.js`：createNode基于同一结构初始化，默认复制skill或保留传入规则，共用公共RulesModel/NodeStateModel；parseNodeOutput/validateNodeOutput严格检查返回内容，结果为副本且不隐式落库。
- `projects/drama/src/project/output_definition.js`：移除开发文档读取，默认解析运行时定义；保留本地引用错误检查。
- `projects/drama/src/prompts/compose_node.js`：统一任务、动作、业务规则、本次资料和程序输出契约；契约独立注入一次，规则/输入保留字面量，跨节点/动作引用拒绝。
- `projects/drama/src/index.js`：导出基础链路API。
- `projects/drama/skills/*.json`：补齐8节点24动作的生成依据、审核判断和修订联动，不复制输出Schema。
- `projects/drama/tests/{output-definition,node-runtime}.test.js`：替换文档驱动的测试，验证运行时链路、响应拒绝、无docs目录运行、持久化和数据隔离。
- `projects/drama/docs/{开发方向.md,project_detail.json}`：明确开发文档边界、运行时字段来源及调用示例。

## 验收标准核对
| AC | 状态 | 运行证据 |
|---|---|---|
| AC-1 | 通过 | 无docs目录的代码副本可初始化、组装、解析；src无文档读取 |
| AC-2 | 通过 | output默认值、独立规则、公共状态和外层人工字段/资产初始化 |
| AC-3 | 通过 | 8节点24动作组装messages；契约只注入一次；字面占位符不二次解释 |
| AC-4 | 通过 | 非法JSON、缺失/额外字段、错误类型、非有限数值、非法枚举/节拍、混合视频模式、矛盾审核结果拒绝 |
| AC-5 | 通过 | 注入同一份新增字段定义，初始化/说明/校验同时变化 |
| AC-6 | 通过 | 每份动作含字段处理方法，输出字段仍引用运行时契约 |

## 测试
- drama基线12通过，最终19通过，0失败、0取消。
- prompt-composer25通过、task33通过，均0失败、0取消。公共包代码未改。
- 三种完整视频接口定义与clip_arrangement/videos/episodes逐项保持原样。
- git diff --check通过。
- 日志：/tmp/drama-runtime-after.log、/tmp/drama-runtime-packages.log。

图谱：变更前已检查状态并刷新，MCP/CLI impact对旧解析函数返回Target not found/UNKNOWN；实际调用检索限定于drama导出和测试，无真实执行器接入。detect_changes为LOW、0受影响流程，新文件另外按清单及测试核对。没有以UNKNOWN或未列出的新增文件作为安全证明，未修改无关图谱代码。

## 人工待办
实际模型/媒体调用、完整项目创建、业务引用/剧情/素材校验和旧项目迁移留待节点执行器阶段。JSON结构校验只实现当前声明使用的关键字，不支持的新Schema关键字会明确拒绝；空节点的零时长初值不作为有效生成结果。视频接口执行保持原状。
