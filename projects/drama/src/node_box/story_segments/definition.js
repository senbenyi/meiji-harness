import { string, number, object, array } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", output: object({
    "segments": array(object({
      "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
      "title": string("当前对象标题。", { minLength: 1 }),
      "body": string("完整正文。", { minLength: 1 }),
      "world_background": string("本段相关世界观与时代设定。"),
      "key_anchors": array(object({
        "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
        "content": string("锚点需要表达的内容。"),
        "expression": string("锚点的视听表达要求。")
      })),
      "characters_and_groups": string("参与人物与群体及作用。"),
      "scene_and_space": string("本段场景与行动空间。"),
      "emotion_and_rhythm": string("情绪发展与叙事节奏。"),
      "duration_seconds": number("本段或节拍的正常表演预估时长，单位秒。", { exclusiveMinimum: 0 }),
      "continuity": object({
        "opening": string("承接前段的事实与起始状态。"),
        "ending": string("本段结果与待续事项。")
      })
    }))
  }) }
