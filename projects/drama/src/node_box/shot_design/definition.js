import { string, number, object, array } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", output: object({
    "shots": array(object({
      "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
      "previous_shot_connection": string("与前镜的叙事衔接类型。", { enum: ["opening", "continuous", "cut"] }),
      "story_segment_id": string("对应故事段ID。", { minLength: 1 }),
      "title": string("当前对象标题。", { minLength: 1 }),
      "key_anchor_ids": array(string("anchor_001")),
      "scene": object({
        "scene_id": string("明确关联的场景ID；无资产时为空。"),
        "state": string("本镜开场环境状态及光照。"),
        "spatial_setup": string("本镜背景区域的固定空间关系。")
      }),
      "characters": array(object({
        "character_id": string("关联人物ID；无资产时为空。"),
        "costume_id": string("选定服装ID；无服装目录时为空。"),
        "name": string("对象名称。", { minLength: 1 }),
        "presence": string("开场在场与入画状态。"),
        "position": string("开场空间位置。"),
        "facing": string("开场身体朝向。"),
        "gaze_target": string("开场目光对象。")
      })),
      "beats": array(object({
        "duration_seconds": number("本段或节拍的正常表演预估时长，单位秒。", { exclusiveMinimum: 0 }),
        "action": string("本节拍行动与反应过程。"),
        "camera": string("本节拍构图与摄影变化。"),
        "scene_changes": string("本节拍独立追踪的环境变化。"),
        "effects": string("本节拍特效表现。"),
        "audio": string("本节拍原话与声音过程。")
      }), { minItems: 1 })
    }))
  }) }
