import { string, number, object } from '../../node_runtime/schema_builders.js'

// 本盒子的运行时字段契约；修改后同步开发结构说明。
export default { kind: "text", initial: { opinion: "" }, output: object({
    "body": string("完整正文。", { minLength: 1 }),
    "estimated_duration_seconds": number("完整优化剧本的预估总时长，单位秒。", { exclusiveMinimum: 0 }),
    "summary": string("当前内容概要。")
  }) }
