import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCTION_ROLES } from '../agents/roles.js'

const NAME = /^[a-z][a-z0-9._-]*$/
const PIPELINE_ID = /^[a-z0-9][a-z0-9._-]*$/
const ROOT_KEYS = new Set(['id', 'version', 'title', 'description', 'phases', 'nodes'])
const COMMON_NODE_KEYS = ['id', 'kind', 'phase', 'dependsOn', 'commit', 'invalidates']
const AGENT_NODE_KEYS = [...COMMON_NODE_KEYS, 'role', 'foreach', 'concurrency', 'inputs', 'outputSchema', 'validators', 'retry', 'prompt']
const BARRIER_NODE_KEYS = COMMON_NODE_KEYS

export const PRODUCTION_SELECTORS = new Set([
  'source-segments', 'episodes', 'assets', 'shots',
  'source-segment', 'source-summaries', 'content-analysis', 'story-bible', 'current-episode', 'episode-source',
  'formal-episode', 'known-assets', 'asset', 'asset-parent', 'asset-usages', 'authored-assets', 'current-shot',
  'neighbor-shots', 'bound-assets',
])

export const PRODUCTION_VALIDATORS = new Set([
  'source-summary-boundaries', 'content-analysis-coverage', 'episode-plan-coverage', 'episode-draft',
  'asset-extraction', 'image-generation', 'storyboard', 'video-generation',
])

export const PRODUCTION_COMMIT_HANDLERS = {
  'complete-production-task': new Set(),
  'submit-development-proposal': new Set(['content_analysis', 'episode_plan', 'episode_draft', 'asset_extraction', 'episode_script', 'shot_prompts']),
}

const defaultSchemasDir = fileURLToPath(new URL('../../schemas/', import.meta.url))

function object(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function resolvePointer(document, pointer) {
  if (!pointer) return document
  if (!pointer.startsWith('/')) return undefined
  return pointer.slice(1).split('/').reduce((value, token) => value?.[token.replaceAll('~1', '/').replaceAll('~0', '~')], document)
}

function dereferenceSchema(value, document, stack = []) {
  if (Array.isArray(value)) return value.map((item) => dereferenceSchema(item, document, stack))
  if (!object(value)) return value
  if (value.$ref) {
    if (!value.$ref.startsWith('#/')) throw new Error(`不支持外部 $ref：${value.$ref}`)
    if (stack.includes(value.$ref)) throw new Error(`Schema 循环引用：${value.$ref}`)
    const target = resolvePointer(document, value.$ref.slice(1))
    if (!object(target)) throw new Error(`Schema 引用不存在：${value.$ref}`)
    const { $ref, ...overrides } = value
    return { ...dereferenceSchema(target, document, [...stack, $ref]), ...dereferenceSchema(overrides, document, stack) }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dereferenceSchema(item, document, stack)]))
}

export function loadProductionOutputSchema(reference, { schemasDir = defaultSchemasDir } = {}) {
  if (typeof reference !== 'string') throw new Error('outputSchema 必须是字符串')
  const [pathPart, pointer = ''] = reference.split('#', 2)
  if (!/^production\/[a-z0-9._/-]+\.schema\.json$/.test(pathPart)) throw new Error(`outputSchema "${reference}" 必须指向 production/*.schema.json`)
  const root = resolve(schemasDir)
  const file = resolve(root, pathPart)
  if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error(`outputSchema "${reference}" 逃逸 schemas 目录`)
  const document = JSON.parse(readFileSync(file, 'utf8'))
  const schema = resolvePointer(document, pointer)
  if (!object(schema)) throw new Error(`outputSchema "${reference}" 的 JSON Pointer 不存在`)
  return dereferenceSchema(schema, document)
}

function validateOutputSchema(reference, schemasDir, fail) {
  try { loadProductionOutputSchema(reference, { schemasDir }) } catch (error) { fail(error.message) }
}

function validateRetry(retry, fail) {
  if (!object(retry)) return fail('retry 必须是对象')
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) fail('retry.maxAttempts 必须是不小于 1 的整数')
  if (!Number.isInteger(retry.timeoutMs) || retry.timeoutMs < 1) fail('retry.timeoutMs 必须是正整数')
  const allowed = new Set(['timeout', 'invalid-output', 'retryable-error'])
  if (!strings(retry.retryOn) || retry.retryOn.some((item) => !allowed.has(item))) fail('retry.retryOn 含未知错误类型')
}

function validateCommit(commit, fail) {
  if (!object(commit) || typeof commit.handler !== 'string') return fail('commit.handler 必须是字符串')
  const kinds = PRODUCTION_COMMIT_HANDLERS[commit.handler]
  if (!kinds) return fail(`commit.handler "${commit.handler}" 未注册`)
  if (kinds.size && !kinds.has(commit.kind)) fail(`commit.kind "${commit.kind}" 不适用于 ${commit.handler}`)
  if (!kinds.size && commit.kind !== undefined) fail(`${commit.handler} 不接受 commit.kind`)
}

function validateGraph(nodes, fail) {
  const byId = new Map(nodes.filter((node) => object(node) && typeof node.id === 'string').map((node) => [node.id, node]))
  if (byId.size !== nodes.length) fail('nodes.id 必须唯一')
  for (const node of nodes) {
    for (const dependency of node.dependsOn || []) if (!byId.has(dependency)) fail(`节点 "${node.id}" 依赖不存在的节点 "${dependency}"`)
    for (const target of node.invalidates || []) if (!byId.has(target)) fail(`节点 "${node.id}" invalidates 不存在的节点 "${target}"`)
  }
  const visiting = new Set(), visited = new Set()
  const visit = (id, path = []) => {
    if (visiting.has(id)) return fail(`生产 DAG 存在循环：${[...path, id].join(' -> ')}`)
    if (visited.has(id) || !byId.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id).dependsOn || []) visit(dependency, [...path, id])
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
}

export function validateProductionPipeline(pipeline, { source = 'pipeline', schemasDir = defaultSchemasDir } = {}) {
  const errors = []
  const fail = (message) => errors.push(`${source}: ${message}`)
  if (!object(pipeline)) return { ok: false, errors: [`${source}: Pipeline 必须是对象`] }
  for (const key of Object.keys(pipeline)) if (!ROOT_KEYS.has(key)) fail(`未知顶层字段 "${key}"`)
  if (typeof pipeline.id !== 'string' || !PIPELINE_ID.test(pipeline.id)) fail('id 必须是小写字母/数字/._- 组成的稳定标识')
  if (!Number.isInteger(pipeline.version) || pipeline.version < 1) fail('version 必须是不小于 1 的整数')
  if (typeof pipeline.title !== 'string' || !pipeline.title.trim()) fail('title 必须是非空字符串')
  if (!Array.isArray(pipeline.phases) || !pipeline.phases.length) fail('phases 必须是非空数组')
  const phases = new Map()
  for (const [index, phase] of (pipeline.phases || []).entries()) {
    if (!object(phase) || typeof phase.id !== 'string' || !NAME.test(phase.id) || typeof phase.title !== 'string' || !phase.title.trim()) fail(`phases[${index}] 必须包含合法 id/title`)
    else if (phases.has(phase.id)) fail(`phase "${phase.id}" 重复`)
    else phases.set(phase.id, phase.title)
  }
  if (!Array.isArray(pipeline.nodes) || !pipeline.nodes.length) return { ok: false, errors: [...errors, `${source}: nodes 必须是非空数组`] }

  for (const [index, node] of pipeline.nodes.entries()) {
    const label = object(node) && node.id ? `节点 "${node.id}"` : `nodes[${index}]`
    const nodeFail = (message) => fail(`${label}: ${message}`)
    if (!object(node)) { nodeFail('必须是对象'); continue }
    const allowedKeys = new Set(node.kind === 'barrier' ? BARRIER_NODE_KEYS : AGENT_NODE_KEYS)
    for (const key of Object.keys(node)) if (!allowedKeys.has(key)) nodeFail(`未知字段 "${key}"`)
    if (typeof node.id !== 'string' || !NAME.test(node.id)) nodeFail('id 必须是小写稳定标识')
    if (!['agent', 'barrier'].includes(node.kind)) nodeFail('kind 必须是 agent 或 barrier')
    if (typeof node.phase !== 'string' || !phases.has(node.phase)) nodeFail(`phase "${node.phase}" 未注册`)
    if (!strings(node.dependsOn)) nodeFail('dependsOn 必须是字符串数组')
    if (node.invalidates !== undefined && !strings(node.invalidates)) nodeFail('invalidates 必须是字符串数组')
    validateCommit(node.commit, nodeFail)
    if (node.kind !== 'agent') continue
    if (!PRODUCTION_ROLES[node.role]) nodeFail(`role "${node.role}" 未注册`)
    if (node.foreach !== undefined && !PRODUCTION_SELECTORS.has(node.foreach)) nodeFail(`foreach "${node.foreach}" 未注册`)
    if (!Number.isInteger(node.concurrency) || node.concurrency < 1) nodeFail('concurrency 必须是正整数')
    if (!strings(node.inputs) || !node.inputs.length) nodeFail('inputs 必须是非空字符串数组')
    else for (const selector of node.inputs) if (!PRODUCTION_SELECTORS.has(selector)) nodeFail(`input selector "${selector}" 未注册`)
    if (!strings(node.validators)) nodeFail('validators 必须是字符串数组')
    else for (const validator of node.validators) if (!PRODUCTION_VALIDATORS.has(validator)) nodeFail(`validator "${validator}" 未注册`)
    validateOutputSchema(node.outputSchema, schemasDir, nodeFail)
    validateRetry(node.retry, nodeFail)
    if (!object(node.prompt) || typeof node.prompt.objective !== 'string' || !node.prompt.objective.trim() || !strings(node.prompt.constraints)) nodeFail('prompt 必须包含 objective 和 constraints')
  }
  validateGraph(pipeline.nodes, fail)
  return { ok: errors.length === 0, errors }
}

export function loadProductionPipelines(dir, options = {}) {
  const pipelines = [], byId = {}, errors = []
  if (!existsSync(dir)) return { pipelines, byId, errors }
  for (const entry of readdirSync(dir).sort()) {
    if (extname(entry).toLowerCase() !== '.json') continue
    const file = join(dir, entry)
    let pipeline
    try { pipeline = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
      errors.push(`${entry}: JSON 解析失败（${error.message}）`)
      continue
    }
    const result = validateProductionPipeline(pipeline, { ...options, source: entry })
    if (!result.ok) { errors.push(...result.errors); continue }
    if (byId[pipeline.id]) { errors.push(`${entry}: id "${pipeline.id}" 重复`); continue }
    pipelines.push(pipeline)
    byId[pipeline.id] = pipeline
  }
  return { pipelines, byId, errors }
}

export function bundledProductionPipelines() {
  return loadProductionPipelines(fileURLToPath(new URL('../../pipelines/', import.meta.url)))
}
