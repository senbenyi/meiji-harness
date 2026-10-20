# drama节点规则JSON

- 类型：完整流程，新增8类AI节点规则配置。
- 目标：每节点一份JSON，可直接深拷贝导入项目对应节点rules；输出说明统一写在动作base内。
- 非目标：不接入项目创建或实际模型调用，不改并行开发的项目Model/manager及工程配置。

## 验收标准与证据
| AC | 输入/状态 → 可观测结果 | 依据 |
|---|---|---|
| AC-1 | 新版项目AI节点 → 8个JSON完整覆盖 | projects/drama/docs/project_detail.json；3类程序节点不提供JSON |
| AC-2 | 每份配置 → 只有supports_supplement/rules，每动作只有base/supplement | 用户最新要求；公共RulesModel |
| AC-3 | 生成/审核/修订 → 各自有完整独立规则和输出说明 | base包含业务要求及输出示例、字段解释；无独立output/JSON Schema结构 |
| AC-4 | 直接导入 → 可JSON往返、深拷贝且公共包结构保持原样 | 撤回上一轮公共Model、测试及project_detail的output扩展 |

## 调用链与改动
参考meiji/shared/prompt-models业务规则及server/http/nodes输出约定，按drama新版字段编写，不直接沿用旧接口字段。配置当前无运行时消费者。

1. projects/drama/skills/*.json：8文件、24动作；输出格式合入base，JSON例子按字段写含义，数字字段另说明类型。视频提示词按已选模式提供3种示例；图片动作接收真实媒体结果。
2. 撤回公共RulesModel及文档中的独立output扩展。图谱影响MEDIUM，7个直接引用，主要为规则面板/测试/公开导出；相关包测试验证恢复。

## 待用户决定
无。

## 验证结果
8节点/24动作结构、规则独立性、深拷贝及公共Model验证通过，3类程序节点排除。公共包最终25通过、0失败、0取消；git diff --check通过。公共Model、测试、包说明及project_detail与HEAD一致。未进行真实模型调用或项目创建集成验收。
