import { readFile } from 'node:fs/promises'
import { RulesModel } from '@agent-modules/prompt-composer'
import { NodeStateModel } from '@agent-modules/task/models'
import { nodeDefinitions } from './node_definition_registry.js'
import { nodeContract } from './output_contract_renderer.js'

function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_NODE_OUTPUT', path })
}

function initialValue(schema) {
  if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default)
  if (schema.oneOf) return initialValue(schema.oneOf[0])
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, initialValue(value)]))
  if (schema.type === 'array') return []
  if (schema.type === 'string') return schema.const ?? schema.enum?.[0] ?? ''
  if (schema.type === 'number' || schema.type === 'integer') return 0
  if (schema.type === 'boolean') return false
  if (schema.type === 'null') return null
  invalid('schema.type', '不支持的初始化类型')
}

/** empty节点的数字初值为0，生成后的结果才按正数等约束校验。 */
export async function createNode(nodeType, { rules, definition = nodeDefinitions } = {}) {
  const { schema } = nodeContract(nodeType, 'generate', definition)
  const savedRules = rules ?? JSON.parse(await readFile(new URL(`../../skills/${nodeType}.json`, import.meta.url), 'utf8'))
  const model = new RulesModel(savedRules).toJSON()
  const result = { ...structuredClone(definition[nodeType].initial ?? {}), node_state: new NodeStateModel({ type: 1, supports_supplement: model.supports_supplement, rules: model.rules }).toJSON() }
  if (schema.type !== 'image') Object.assign(result, initialValue(schema))
  return result
}

