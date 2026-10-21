import { string, object, array } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", output: object({
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
  }) }
