import { nodeDefinitions } from './node_definition_registry.js'
import { nodeContract } from './output_contract_renderer.js'

function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_NODE_OUTPUT', path })
}

// 仅实现本项目使用的Schema关键字，不负责业务引用、素材或内容质量判定。
const schemaKeys = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'oneOf', 'minItems', 'maxItems', 'minLength', 'minimum', 'maximum', 'exclusiveMinimum', 'const', 'enum', 'default'])
function validate(schema, value, path) {
  for (const key of Object.keys(schema)) if (!schemaKeys.has(key)) invalid(path, `不支持的Schema约束：${key}`)
  if (schema.oneOf) {
    const accepted = schema.oneOf.filter(option => {
      try { validate(option, value, path); return true } catch (error) { if (error.code === 'INVALID_NODE_OUTPUT') return false; throw error }
    })
    if (accepted.length !== 1) invalid(path, '必须且只能匹配一种输出结构')
    return
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, '需为普通对象')
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, '缺少必填字段')
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) { if (schema.additionalProperties === false) invalid(`${path}.${key}`, '不允许额外字段'); continue }
      validate(schema.properties[key], value[key], `${path}.${key}`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) invalid(path, '需为数组')
    if (schema.minItems !== undefined && value.length < schema.minItems) invalid(path, '数组条目不足')
    if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid(path, '数组条目过多')
    for (let index = 0; index < value.length; index++) validate(schema.items, value[index], `${path}[${index}]`)
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value))) invalid(path, '数字类型错误')
    if (schema.minimum !== undefined && value < schema.minimum) invalid(path, '低于最小值')
    if (schema.maximum !== undefined && value > schema.maximum) invalid(path, '高于最大值')
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) invalid(path, '需大于最小值')
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') invalid(path, '需为文本')
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) invalid(path, '文本过短或为空')
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') invalid(path, '需为布尔值')
  } else if (schema.type === 'null') {
    if (value !== null) invalid(path, '需为null')
  } else invalid(path, '不支持的Schema类型')
  if (Object.hasOwn(schema, 'const') && value !== schema.const) invalid(path, '固定值不匹配')
  if (schema.enum && !schema.enum.includes(value)) invalid(path, '不在允许的枚举中')
}

export function validateNodeOutput(nodeType, action, value, { definition = nodeDefinitions } = {}) {
  const { schema } = nodeContract(nodeType, action, definition)
  if (schema.type === 'image') invalid('output', '图片结果由媒体接口适配器处理，不接受语言模型JSON地址')
  validate(schema, value, 'output')
  return structuredClone(value)
}

export function parseNodeOutput(nodeType, action, response, options) {
  let value = response
  if (typeof response === 'string') {
    try { value = JSON.parse(response) } catch { invalid('response', '不是有效JSON') }
  }
  return validateNodeOutput(nodeType, action, value, options)
}
