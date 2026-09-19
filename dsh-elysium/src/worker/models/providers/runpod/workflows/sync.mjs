#!/usr/bin/env node
// 职责：从选中平台获取并编译工作流，校验或同步 MiniMax H3 工作流模板。
import { resolveServer } from '../../../catalog/servers.js'
import { backendWorkflowSource } from '../../../index.js'
import { resolveConfig, withConfig } from '../../../../../config.js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DIRECTORY = fileURLToPath(new URL('./minimax-h3/templates', import.meta.url))
export const WORKFLOWS = {
  t2va: { file: 'MiniMaxH3-Turbo-T2VA.json', macros: [105], mirrors: [137], media: {} },
  i2va: { file: 'MiniMaxH3-Turbo-I2VA.json', macros: [105], mirrors: [137], media: { first_frame: 114 } },
  fl2va: { file: 'MiniMaxH3-Turbo-FL2VA.json', macros: [105], mirrors: [137], media: { first_frame: 114, last_frame: 147 } },
  'fl2va-loop': { file: 'MiniMaxH3-Turbo-FL2VA-Loop.json', macros: [105, 255], media: { first_frame: 114, last_frame: 147 } },
  r2va: { file: 'MiniMaxH3-Turbo-R2VA.json', macros: [105], mirrors: [137], media: { reference_image_1: 114, reference_image_2: 152 } },
}
const WIDGET_TYPES = new Set(['BOOLEAN', 'COMBO', 'FLOAT', 'INT', 'STRING'])
const MISSING = Symbol('missing')

async function requestJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'dsh-elysium-workflow-sync/1.0' }, signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  const body = Buffer.from(await response.arrayBuffer())
  return [body, JSON.parse(body)]
}

function normalizeLinks(rows) {
  const result = new Map()
  for (const row of rows) {
    const values = Array.isArray(row) ? row.slice(0, 6) : ['id', 'origin_id', 'origin_slot', 'target_id', 'target_slot', 'type'].map(key => row[key])
    result.set(values[0], values)
  }
  return result
}

class Compiler {
  constructor(workflow, schemas) {
    this.workflow = workflow
    this.schemas = schemas
    this.definitions = new Map((workflow.definitions?.subgraphs || []).map(item => [item.id, item]))
    this.graph = {}
    this.containers = new Map()
    this.instances = new Map()
  }

  key(prefix, nodeId) { return `${prefix}${nodeId}` }

  container(prefix, definition = undefined) {
    if (!this.containers.has(prefix)) {
      const source = definition || this.workflow
      this.containers.set(prefix, [new Map(source.nodes.map(node => [node.id, node])), normalizeLinks(source.links || [])])
    }
    return this.containers.get(prefix)
  }

  source(prefix, nodeId, slot, definition = undefined, external = undefined) {
    if (nodeId === -10) return external[slot]
    const [nodes, links] = this.container(prefix, definition)
    const node = nodes.get(nodeId)
    if (this.definitions.has(node.type)) return this.expandMacro(prefix, node, definition, external)[slot]
    const schema = this.schemas[node.type]
    if ([2, 4].includes(node.mode || 0) || schema === undefined) {
      const outputType = (node.outputs || [])[slot]?.type
      let candidates = (node.inputs || []).filter(item => item.link != null && item.type === outputType)
      if (schema === undefined && candidates.length === 0) candidates = (node.inputs || []).filter(item => item.link != null)
      if (candidates.length !== 1) throw new Error(`Cannot bypass ${node.type} output ${slot}`)
      const row = links.get(candidates[0].link)
      return this.source(prefix, row[1], row[2], definition, external)
    }
    this.compileNode(prefix, node, definition, external)
    return [this.key(prefix, nodeId), slot]
  }

  expandMacro(prefix, macro, definition = undefined, external = undefined) {
    const cacheKey = `${prefix}:${macro.id}`
    if (this.instances.has(cacheKey)) return this.instances.get(cacheKey)
    const subgraph = this.definitions.get(macro.type)
    const [, links] = this.container(prefix, definition)
    const connected = Object.fromEntries((macro.inputs || []).map(item => [item.name, item.link]))
    const values = []
    let widgetIndex = 0
    for (const item of subgraph.inputs || []) {
      const linkId = connected[item.name]
      let widgetValue = MISSING
      if (WIDGET_TYPES.has(item.type)) widgetValue = (macro.widgets_values || [])[widgetIndex++]
      values.push(linkId == null ? widgetValue : this.source(prefix, links.get(linkId)[1], links.get(linkId)[2], definition, external))
    }
    const childPrefix = `${prefix}${macro.id}_`
    const [childNodes, childLinks] = this.container(childPrefix, subgraph)
    for (const node of childNodes.values()) {
      if ((node.mode || 0) === 0 && this.schemas[node.type]) this.compileNode(childPrefix, node, subgraph, values)
    }
    const outputs = (subgraph.outputs || []).map((_, index) => {
      const row = [...childLinks.values()].find(item => item[3] === -20 && item[4] === index)
      return this.source(childPrefix, row[1], row[2], subgraph, values)
    })
    this.instances.set(cacheKey, outputs)
    return outputs
  }

  compileNode(prefix, node, definition = undefined, external = undefined) {
    const nodeKey = this.key(prefix, node.id)
    if (this.graph[nodeKey]) return
    const schema = this.schemas[node.type]
    const allowed = new Set([...Object.keys(schema.input?.required || {}), ...Object.keys(schema.input?.optional || {})])
    const inputs = Object.fromEntries(Object.entries(node.widgets_values_named || {}).filter(([key]) => allowed.has(key)))
    const [, links] = this.container(prefix, definition)
    for (const item of node.inputs || []) {
      if (item.link == null) continue
      const row = links.get(item.link)
      const value = this.source(prefix, row[1], row[2], definition, external)
      if (value !== MISSING) inputs[item.name] = value
    }
    this.graph[nodeKey] = { class_type: node.type, inputs, _meta: { title: node.title || node.type, source_id: nodeKey } }
  }

  compile() {
    const [nodes] = this.container('n')
    for (const node of nodes.values()) {
      if ((node.mode || 0) !== 0) continue
      if (this.schemas[node.type]) this.compileNode('n', node)
      else if (this.definitions.has(node.type)) this.expandMacro('n', node)
    }
    return this.graph
  }

  macroInputBinding(macroId, name) {
    const macro = this.workflow.nodes.find(node => node.id === macroId)
    const subgraph = this.definitions.get(macro.type)
    const slot = subgraph.inputs.findIndex(item => item.name === name)
    const row = [...normalizeLinks(subgraph.links).values()].find(item => item[1] === -10 && item[2] === slot)
    const target = subgraph.nodes.find(node => node.id === row[3])
    return { node: this.key(`n${macroId}_`, target.id), input: target.inputs[row[4]].name }
  }
}

function validate(graph, schemas) {
  for (const [nodeId, node] of Object.entries(graph)) {
    const schema = schemas[node.class_type]
    const required = schema.input?.required || {}, optional = schema.input?.optional || {}
    const dynamic = new Set(Object.entries({ ...required, ...optional }).filter(([, spec]) => spec[0] === 'COMFY_AUTOGROW_V3').map(([name]) => name))
    const missing = Object.keys(required).filter(name => !(name in node.inputs) && !(dynamic.has(name) && Object.keys(node.inputs).some(key => key.startsWith(`${name}.`))))
    const unknown = Object.keys(node.inputs).filter(name => !(name in required) && !(name in optional) && ![...dynamic].some(root => name.startsWith(`${root}.`)))
    if (missing.length || unknown.length) throw new Error(`${nodeId} inputs missing=${missing.sort()} unknown=${unknown.sort()}`)
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && !graph[value[0]]) throw new Error(`${nodeId}.${name} links to missing ${value[0]}`)
    }
  }
}

export function compileBundle(mode, workflow, schemas, sourcePath, digest) {
  const config = WORKFLOWS[mode], compiler = new Compiler(workflow, schemas), graph = compiler.compile()
  validate(graph, schemas)
  const prompt = config.macros.map(nodeId => compiler.macroInputBinding(nodeId, 'prompt'))
  prompt.push(...(config.mirrors || []).map(nodeId => ({ node: compiler.key('n', nodeId), input: 'anything' })))
  for (const item of prompt) graph[item.node].inputs[item.input] = ''
  const bindings = {
    prompt,
    media: Object.fromEntries(Object.entries(config.media).map(([name, nodeId]) => [name, { node: compiler.key('n', nodeId), input: 'image' }])),
    output: { node: compiler.key('n', 126), input: 'filename_prefix' },
  }
  for (const item of [...bindings.prompt, ...Object.values(bindings.media), bindings.output]) {
    if (!graph[item.node] || !(item.input in graph[item.node].inputs)) throw new Error(`Invalid ${mode} binding: ${JSON.stringify(item)}`)
  }
  return { mode, source: { path: sourcePath, sha256: digest }, workflow, graph, bindings }
}

async function * build(baseUrl) {
  baseUrl = baseUrl.replace(/\/+$/, '')
  const [, schemas] = await requestJson(`${baseUrl}/object_info`)
  for (const [mode, config] of Object.entries(WORKFLOWS)) {
    const sourcePath = `minimax/${config.file}`
    const [body, workflow] = await requestJson(`${baseUrl}/userdata/${encodeURIComponent(`workflows/${sourcePath}`)}`)
    yield [mode, compileBundle(mode, workflow, schemas, sourcePath, createHash('sha256').update(body).digest('hex'))]
  }
}

export async function main(args = process.argv.slice(2)) {
  const check = args.includes('--check'), sync = args.includes('--sync')
  if (check === sync) throw new Error('choose exactly one of --check or --sync')
  const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  const url = value('--url') || await withConfig(resolveConfig(), () => backendWorkflowSource(resolveServer())), output = value('--output-dir') || DIRECTORY
  for await (const [mode, bundle] of build(url)) {
    const target = join(output, `${mode}.json`)
    if (check) {
      if (JSON.stringify(JSON.parse(await readFile(target, 'utf8'))) !== JSON.stringify(bundle)) throw new Error(`Server workflow differs: ${target}`)
    } else {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, `${JSON.stringify(bundle, null, 2)}\n`)
    }
    console.log(`${check ? 'CHECK' : 'SYNC'} ${mode} ${bundle.source.sha256}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1) })
