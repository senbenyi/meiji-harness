import { RulesModel, renderSections, composeMessages } from '@agent-modules/prompt-composer'
import { nodeDefinitions } from './node_definition_registry.js'
import { nodeContract, outputInstructions, renderNodeRules } from './output_contract_renderer.js'

/** 仅接收调用方已筛选的本次资料；不读取整份项目或默认覆盖已保存业务规则。 */
export function composeNodePrompt({ nodeType, action, rules, input, goal = '', definition = nodeDefinitions }) {
  const { reference, schema } = nodeContract(nodeType, action, definition)
  if (!rules || typeof rules !== 'object') throw new TypeError('需提供项目内已保存的规则Model或数据')
  const data = new RulesModel(typeof rules?.toJSON === 'function' ? rules.toJSON() : rules).toJSON()
  const stripReference = text => {
    const result = text.replace(/\{\{output:([^{}]*?)\}\}/gu, (_, value) => {
      if (value !== reference) throw new TypeError('规则引用与当前节点动作的输出契约不一致')
      return '输出字段遵循程序提供的输出契约。'
    })
    if (result.includes('{{output:')) throw new TypeError('输出引用未完整声明')
    return result
  }
  data.rules[action].base = stripReference(data.rules[action].base)
  if (data.supports_supplement) data.rules[action].supplement = stripReference(data.rules[action].supplement)
  const selected = renderNodeRules(data, action, { definition })
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input需为本次资料对象')
  if (typeof goal !== 'string') throw new TypeError('goal需为文本')
  // 规则和输入不经fillTemplate再次展开，{{…}}等字面内容保持原样。
  return composeMessages({
    system: renderSections({ 任务: `节点：${nodeType}；动作：${action}`, 基础规则: selected.base, 补充规则: selected.supplement, 输出契约: outputInstructions(schema, { format: action === 'review' ? 'schema' : definition[nodeType].output_format }) }),
    user: renderSections({ 当前目标: goal, 本次资料: input }, { jsonKeys: ['本次资料'] }),
  })
}
