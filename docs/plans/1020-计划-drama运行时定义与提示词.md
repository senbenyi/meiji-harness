# drama运行时定义与提示词

- 类型：完整流程，运行时结构与提示词基础链路。
- 目标：运行时节点定义成为初始化、输出说明和响应校验的唯一来源；skill只保存业务方法；开发文档不参与运行。
- 非目标：不改视频接口/程序节点、公共包、真实模型调用、节点执行器和旧项目迁移。

## 验收标准与调研
| AC | 输入/状态 → 可观测结果 | 证据/状态 |
|---|---|---|
| AC-1 | 六类文本节点与两类生图动作 → 输出结构来自node_definitions.js，src不读docs | 已确认当前缺陷：output_definition.js读取docs/project_detail.json |
| AC-2 | 新建AI节点 → 依据同一结构创建独立output、默认规则和公共NodeStateModel数据 | 待实施；当前ProjectModel只保存普通JSON，保持其职责不变 |
| AC-3 | 节点/动作/已保存规则/实际输入 → 统一入口输出可发给公共编排器的messages，输出契约由程序注入 | 待实施；保留既有规则引用，统一组装时不重复输出结构 |
| AC-4 | 响应结果 → 从同一结构严格检查类型、必填、额外字段、数字及枚举、模式互斥和审核结论；图片仍走媒体接口 | 待实施；不调用真实服务，不允许模型编造图片地址 |
| AC-5 | Model字段变化 → 初始化、输出提示词、响应校验同步变化 | 待实施；以注入的新运行时定义验证，无文档依赖 |
| AC-6 | skill三动作 → 明确复杂字段生成/审核/修订依据，不复制字段Schema | 已有规则可复用，补齐不足的复杂字段方法；24动作保持base/supplement |

## 调用链与影响
现状renderNodeRules → readFile(docs/project_detail.json) → resolveOutputDefinition；仅src/index导出、drama测试调用。ProjectManager/Model保持纯数据存取。原drama12通过、0失败、0取消。适用GitNexus重构流程，先status/刷新，query定位解析器，impact覆盖旧解析函数，字符串引用和新定义以源码/配置校验补充。

## 改动
1. src/project/node_definitions.js：节点输出字段的运行时类型/基本含义及统一审核/媒体契约。
2. src/project/output_definition.js：移除文档读取，引用运行时定义；src/project/node_output.js：初始化和响应校验；新建节点沿用公共RulesModel/NodeStateModel。
3. src/prompts/compose_node.js：任务/动作、业务规则、实际资料、输出契约统一组装；业务文本不经模板二次解释。
4. skills/*.json：完善字段生成/审核/修订方法，保留引用；docs同步说明；原文档输出仅为开发参考。
5. tests覆盖24动作、文档缺失不影响运行、字段联动、合法/非法响应、互斥模式、数据隔离和项目持久化。

## 待用户决定
无。

## 验证
npm run test:drama；相关prompt-composer/task测试；JSON及文档引用检查；git diff --check；detect_changes与最终索引刷新。真实模型与节点执行器接入明确未验证。

## 验证结果
- AC-1～AC-6通过。运行时代码不含docs/project_detail/definitionFile读取；无docs目录的临时副本完成初始化、组装与解析校验。
- 运行时定义字段变化联动初始化默认值、消息中的输出结构和响应必填校验；24动作仅保留base/supplement，复杂字段处理方法均已补齐。
- drama基线12通过，最终19通过、0失败、0取消；prompt-composer25通过，task33通过，均0失败/取消。
- 视频接口的3种完整结构及clip_arrangement/videos/episodes与HEAD逐项相同，公共包未修改。
- git diff --check通过；JSON配置、引用和Schema由相关测试覆盖。
- 变更前MCP/CLI impact对旧解析函数均返回Target not found/UNKNOWN，已在刷新后补查全部实际调用：仅drama入口及相关测试，不存在已接入的真实执行器。变更后detect_changes为LOW、0受影响流程；新文件以清单/测试补充，不将空图谱结果作为无影响证明。
- 未调用真实模型、未实现自动项目创建和旧项目迁移；已提供节点初始化及校验后通过ProjectManager写入的完整基础示例。
