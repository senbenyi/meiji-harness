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
      "group_ids": array(string("明确所属的团队ID；无所属团队为空数组。")),
      "signature_props": array(object({
        "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
        "name": string("对象名称。", { minLength: 1 }),
        "description": string("对象完整外观或环境身份描述。")
      })),
      "immutable_traits": array(string("明确不可改变的人物特征。")),
      "costumes": array(object({
        "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
        "name": string("对象名称。", { minLength: 1 }),
        "description": string("具体个人服装描述；原文未写也结合职业、年代与场景设计。引用团队制服时继承基础设计，仅补个人差异；UI在服装字段下展示名称与描述。"),
        "group_id": string("引用的团队ID；个人独立服装为空字符串。"),
        "group_costume_id": string("引用的团队服装版本ID；与group_id同时为空或同时有效。"),
        "story_segment_ids": array(string("适用故事段ID；空数组表示通用。"))
      }))
    }))
  }) }
