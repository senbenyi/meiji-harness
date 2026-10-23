import { string, number, object, array } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", output_format: 'template', output: object({
    "segments": array(object({
      "id": string("segment_001", { minLength: 1 }),
      "title": string("故事段标题。", { minLength: 1 }),
      "body": string("最终改编定稿的完整剧情正文、对白及重要描述；按因果与阶段结果分段，不是事件摘要，供下游视听实现。", { minLength: 1 }),
      "world_background": string("与本段有关的世界观、时代背景和影响剧情的重要设定；不另设全剧共用资料对象。"),
      "key_anchors": array(object({
        "id": string("segment_001_anchor_001；新建锚点使用所属故事段ID加_anchor_及至少三位正整数序号，段内从001递增，整份大纲唯一；已有锚点保留原ID。", { minLength: 1 }),
        "content": string("本段必须表达的事实、态度、程度、情绪、世界观信息或伏笔。"),
        "expression": string("以画面、对白、动作、声音或其组合落实的要求；明确原话与画面文字仍逐字保留。")
      })),
      "characters_and_groups": string("参与人物、背景群体、在场状态及各自作用；不重复保存完整人物资产。"),
      "scene_and_space": string("所在场景、初始分布、建筑区域及行动关系；稳定布局由场景资产提供。"),
      "emotion_and_rhythm": string("情绪起止、压力积累、转折、释放及观看期待。"),
      "duration_seconds": number("最终剧情正常表演的粗略预估时长，单位秒，大于0；仅供制作参考，不作为剧情或分段的时间限制。", { exclusiveMinimum: 0 }),
      "continuity": object({
        "opening": string("承接前段的事实和初始状态。"),
        "ending": string("本段结果、待续事项及后段承接。")
      })
    }))
  }) }
