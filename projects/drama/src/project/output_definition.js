import { nodeDefinitions } from './node_definitions.js'
const actions = ['generate', 'review', 'revise']

function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_OUTPUT_DEFINITION', path })
}

function pointerValue(reference, definition) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) invalid('reference', '仅支持文档内的 JSON Pointer（#/…）')
  let value = definition
  for (const segment of reference.slice(2).split('/')) {
    if (/~(?![01])/u.test(segment)) invalid(reference, 'JSON Pointer转义无效')
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) invalid(reference, `字段不存在：${key}`)
    value = value[key]
  }
  return value
}

/** 读取声明的结构及字段解释，展开本地$ref；不按实际项目数据推断类型。 */
export function resolveOutputDefinition(reference, definition = nodeDefinitions) {
  function expand(value, references, ancestors) {
    if (!value || typeof value !== 'object') return value
    if (ancestors.has(value)) invalid(reference, '定义包含循环')
    const parents = new Set(ancestors).add(value)
    if (Object.hasOwn(value, '$ref')) {
      if (Object.keys(value).length !== 1) invalid(reference, '$ref对象不能附带其他字段')
      return follow(value.$ref, references, parents)
    }
    return Array.isArray(value)
      ? value.map(item => expand(item, references, parents))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, references, parents)]))
  }
  function follow(target, references, ancestors) {
    if (references.has(target)) invalid(target, '引用包含循环')
    return expand(pointerValue(target, definition), new Set(references).add(target), ancestors)
  }
  return follow(reference, new Set(), new Set())
}

export function outputInstructions(contract) {
  if (contract.type === 'image') return contract.description
  return `只返回符合以下JSON Schema的完整JSON，不附解释或Markdown围栏。字段description解释内容含义；必填、类型、枚举和互斥结构由程序约束，业务规则不能改写输出结构。\n${JSON.stringify(contract, null, 2)}`
}

/** 展开已保存规则中的运行时定义引用，不读取开发文档。 */
export function renderNodeRules(model, action, { definition = nodeDefinitions } = {}) {
  if (!actions.includes(action)) invalid('action', '需为generate、review或revise')
  const data = typeof model?.toJSON === 'function' ? model.toJSON() : model
  if (typeof data?.supports_supplement !== 'boolean') invalid('supports_supplement', '需为布尔值')
  const rule = data.rules?.[action]
  if (typeof rule?.base !== 'string' || typeof rule?.supplement !== 'string') invalid(action, '需提供base和supplement文本')
  const source = definition
  function render(text) {
    const result = text.replace(/\{\{output:([^{}]*?)\}\}/gu, (_, reference) => {
      const resolved = resolveOutputDefinition(reference, source)
      if (typeof resolved === 'string') return resolved
      return outputInstructions(resolved)
    })
    if (result.includes('{{output:')) invalid(action, '输出引用未完整展开')
    return result
  }
  return { base: render(rule.base), supplement: data.supports_supplement ? render(rule.supplement) : '' }
}
