import { string, object, array } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", initial: { assets: [] }, output: object({
    "characters": array(object({
      "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
      "name": string("对象名称。", { minLength: 1 }),
      "social_role": string("身份、职位或社会角色。"),
      "age_range": string("有依据的年龄段，不推算精确年龄。"),
      "nationality": string("国籍或所属族群。"),
      "gender": string("性别。"),
      "era": string("所属时代。"),
      "height": string("身高。"),
      "body_type": string("体型。"),
      "facial_features": string("面部特征。"),
      "hairstyle": string("发型。"),
      "voice": string("稳定声线特征；具体台词与发声时序写入分镜。"),
      "relationships": string("人物之间已确认的稳定关系。"),
      "signature_props": array(object({
        "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
        "name": string("对象名称。", { minLength: 1 }),
        "description": string("对象完整外观或环境身份描述。")
      })),
      "immutable_traits": array(string("明确不可改变的人物特征。")),
      "costumes": array(object({
        "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
        "name": string("对象名称。", { minLength: 1 }),
        "description": string("对象完整外观或环境身份描述。")
      }))
    }))
  }) }
