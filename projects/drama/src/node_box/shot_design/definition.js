import { string, number, object, array } from '../../node_runtime/schema_builders.js'

const advice = object({ location: string('建议所在位置。'), reason: string('非阻断的改进建议。'), suggestion: string('可选改进，不因此返修。') })
const blocker = object({
  category: string('仅阻断真实遗漏、逐字对白错误、事件顺序错误、不可执行的连续性矛盾、资产冲突或规则冲突；审美偏好放suggestions。', { enum: ['omission', 'dialogue', 'order', 'continuity', 'reference', 'rule'] }),
  location: string('当前镜头/节拍/字段。', { minLength: 1 }),
  reason: string('证据支持的、当前仍成立的具体错误。', { minLength: 1 }),
  suggestion: string('最小必要修正，不重写无关镜头。', { minLength: 1 }),
  source_path: string('依据在本次资料中的JSON Pointer，如/story_outline/segments/0/body或/current_shots/shots/0/beats/0/action；规则依据使用/rules/review/base。', { minLength: 1 }),
  source_quote: string('从source_path对应资料逐字摘取，不得改字或把概述编成对白。', { minLength: 1 }),
  candidate_path: string('当前候选的JSON Pointer，必须以/current_shots/开头。', { minLength: 1 }),
  candidate_quote: string('逐字摘取当前错误内容；遗漏时可为空，但不得声称候选已经包含的原文缺失。'),
  previous_issue_index: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }], description: '对应previous_issues的索引；新问题为null。' },
})
const priorCheck = object({
  issue_index: { type: 'integer', minimum: 0, description: 'previous_issues中的索引，逐项覆盖一次。' },
  state: string('先核对旧问题，再给本轮结论。', { enum: ['resolved', 'unresolved'] }),
  reason: string('根据最新候选判断已解决或仍存在，历史意见不是事实。', { minLength: 1 }),
  candidate_path: string('最新候选的JSON Pointer。', { minLength: 1 }),
  candidate_quote: string('最新候选中的真实原文证据。', { minLength: 1 }),
})
const reviewFields = { suggestions: array(advice), previous_issue_checks: array(priorCheck) }

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", review_output: { oneOf: [
  object({ status: { type: 'string', const: 'passed' }, issues: array(blocker, { maxItems: 0 }), ...reviewFields }),
  object({ status: string('只有有据阻断问题才返回未通过。', { enum: ['content_issue', 'upstream_issue', 'rule_conflict'] }), issues: array(blocker, { minItems: 1 }), ...reviewFields }),
] }, output: object({
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
