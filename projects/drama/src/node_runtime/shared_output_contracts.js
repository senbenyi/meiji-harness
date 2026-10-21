import { string, object, array } from './schema_builders.js'

// 多个盒子共用的审核结论和图片真实媒体返回约定。
const issue = object({
  location: string('候选或实际引用上游的具体对象和字段位置。', { minLength: 1 }),
  reason: string('当前仍成立的问题事实及依据。', { minLength: 1 }),
  suggestion: string('最小修正方向；需改上游或规则时明确处理位置。', { minLength: 1 }),
})
export const review_output = { oneOf: [
  object({ status: { type: 'string', const: 'passed', description: '通过。' }, issues: array(issue, { maxItems: 0 }) }),
  object({ status: string('本节点内容问题、上游问题或规则冲突。', { enum: ['content_issue', 'upstream_issue', 'rule_conflict'] }), issues: array(issue, { minItems: 1 }) }),
] }
export const image_output = { type: 'image', description: '返回图片接口的真实媒体结果，由适配器解析并保存有效图片地址；不让语言模型编造JSON地址。' }
