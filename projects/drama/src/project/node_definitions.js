// 运行时输出的唯一字段定义；开发文档只描述这些结构，不参与执行。
const string = (description, options = {}) => ({ type: 'string', description, ...options })
const number = (description, options = {}) => ({ type: 'number', description, ...options })
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const array = (items, options = {}) => ({ type: 'array', items, ...options })

const issue = object({
  location: string('候选或实际引用上游的具体对象和字段位置。', { minLength: 1 }),
  reason: string('当前仍成立的问题事实及依据。', { minLength: 1 }),
  suggestion: string('最小修正方向；需改上游或规则时明确处理位置。', { minLength: 1 }),
})
const review = { oneOf: [
  object({ status: { type: 'string', const: 'passed', description: '通过。' }, issues: array(issue, { maxItems: 0 }) }),
  object({ status: string('本节点内容问题、上游问题或规则冲突。', { enum: ['content_issue', 'upstream_issue', 'rule_conflict'] }), issues: array(issue, { minItems: 1 }) }),
] }
const media = { type: 'image', description: '返回图片接口的真实媒体结果，由适配器解析并保存有效图片地址；不让语言模型编造JSON地址。' }

export const nodeDefinitions = {
  $defs: { review_output: review, image_output: media },
  script_revision: { kind: "text", initial: { opinion: "" }, output: object({
    "body": string("完整正文。", { minLength: 1 }),
    "estimated_duration_seconds": number("完整优化剧本的预估总时长，单位秒。", { exclusiveMinimum: 0 }),
    "summary": string("当前内容概要。")
  }) },
  story_segments: { kind: "text", output: object({
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
  }) },
  character_extraction: { kind: "text", initial: { assets: [] }, output: object({
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
  }) },
  scene_extraction: { kind: "text", initial: { assets: [] }, output: object({
    "scenes": array(object({
      "id": string("稳定标识；已有对象保留原ID。", { minLength: 1 }),
      "name": string("对象名称。", { minLength: 1 }),
      "description": string("对象完整外观或环境身份描述。"),
      "layout": string("权威固定布局与建筑相对关系，不因机位变化改动。"),
      "materials": string("主要材质及色彩。"),
      "lighting": string("基础光源与光照；剧情中昼夜或天气变化由分片和Shot状态描述。"),
      "entrances_and_routes": string("出入口、区域连通关系及可通行路径。"),
      "fixed_landmarks": string("跨镜复用的固定参照及其名称。")
    }))
  }) },
  shot_design: { kind: "text", output: object({
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
  }) },
  video_prompt: { kind: "text", output: object({
    items: array({ oneOf: [
      object({
        "clip_id": string("本次指定分片ID。", { minLength: 1 }),
        "text_to_video": object({
          "prompt": object({
            "integrated_multimodal_description": string("完整视听过程。"),
            "overall_soundscape": string("环境声、动作声与非语言人声。"),
            "non_diegetic_music": string("非叙事配乐；没有时为N/A。")
          })
        })
      }),
      object({
        "clip_id": string("本次指定分片ID。", { minLength: 1 }),
        "multimodal": object({
          "prompt": object({
            "subject_definitions": string("参考主体定义。"),
            "summary": string("当前内容概要。"),
            "retention_analysis": string("素材需要保留的特征。"),
            "detailed_description": string("完整视听过程。"),
            "overall_soundscape": string("环境声、动作声与非语言人声。"),
            "non_diegetic_music": string("非叙事配乐；没有时为N/A。")
          })
        })
      }),
      object({
        "clip_id": string("本次指定分片ID。", { minLength: 1 }),
        "first_last_frame": object({
          "prompt": object({
            "instruction": string("首帧与明确目标尾帧的对应说明。"),
            "integrated_multimodal_description": string("完整视听过程。"),
            "overall_soundscape": string("环境声、动作声与非语言人声。"),
            "non_diegetic_music": string("非叙事配乐；没有时为N/A。")
          })
        })
      })
    ] }),
  }) },
  costume_image: { kind: "image", initial: { reference_image: "", aspect_ratio: "", address: "" }, output: media },
  scene_image: { kind: "image", initial: { reference_image: "", aspect_ratio: "", address: "" }, output: media },
}
