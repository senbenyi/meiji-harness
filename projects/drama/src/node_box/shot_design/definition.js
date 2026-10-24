import { string, number, object, array } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", output: object({
    "shots": array(object({
      "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
      "previous_shot_connection": string("与前镜的叙事衔接类型。", { enum: ["opening", "continuous", "cut"] }),
      "story_segment_id": string("对应故事段ID。", { minLength: 1 }),
      "title": string("当前对象标题。", { minLength: 1 }),
      "key_anchor_ids": array(string("segment_001_anchor_001；引用故事段中实际保存的锚点ID，已有ID保持原样。")),
      "scene": object({
        "scene_id": string("明确关联的场景ID；无资产时为空。"),
        "state": string("本镜开场环境状态及光照。"),
        "spatial_setup": string("本镜背景区域的固定空间关系。")
      }),
      "groups": array(object({
        "group_id": string("明确关联的团队ID。", { minLength: 1 }),
        "costume_id": string("该团队中选定的服装版本ID；无统一服装时为空。"),
        "presence": string("本镜开场群体在场、可见范围与规模，不将团队成员画成同一张脸。"),
        "position": string("群体开场所在区域与分布。"),
        "facing": string("群体主要朝向及必要差异。"),
        "gaze_target": string("群体主要注视对象。")
      })),
      "characters": array(object({
        "character_id": string("关联人物ID；无资产时为空。"),
        "costume_id": string("人物服装ID；未描述换装则沿用已有定妆服装，可跨故事段；多套时承接已选穿着，明确换装才切换；无服装目录时为空。"),
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
