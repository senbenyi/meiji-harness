// 职责：生成任务执行代码指纹，并汇总已持久化的执行跟踪。
import { createHash } from 'node:crypto'
import { runtimeConfig, workcardConfig } from '../../config.js'
import { providerSourceFiles } from '../models/index.js'
import { readdir, readFile } from 'node:fs/promises'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const src = new URL('../../', import.meta.url)
// 参与受理、路由、执行和汇总的公共代码按目录整体纳入；平台代码只纳入当前任务的 provider。
const EXECUTION_SOURCES = ['worker/intake/', 'worker/manager/', 'worker/routing/', 'worker/store/', 'worker/runner/', 'worker/results/',
  'worker/models/catalog/', 'worker/models/protocols/', 'worker/models/index.js', 'tools/', 'config.js', 'utils/errors.js', 'database/json.js']

async function sourceFiles(url) {
  if (!url.pathname.endsWith('/')) return [url]
  const entries = (await readdir(url, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sourceFiles(new URL(entry.name + '/', url))
    : /\.m?js$/.test(entry.name) ? [new URL(entry.name, url)] : []))).flat()
}

export async function codeVersion(provider = runtimeConfig().ELYSIUM_BACKEND?.provider) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', src), 'utf8'))
  const files = [...(await Promise.all(EXECUTION_SOURCES.map(path => sourceFiles(new URL(path, src))))).flat(), ...provider ? await providerSourceFiles(provider) : []]
  const sources = await Promise.all(files.map(url => readFile(url)))
  return { plugin_version: pkg.version, executor_sha256: hash(Buffer.concat([...sources, Buffer.from(JSON.stringify(workcardConfig))])) }
}

export function traceDiagnostics(chain) {
  const spans = new Map()
  for (const item of chain) {
    if (!item.span_id || !item.timestamp) continue
    const time = Date.parse(item.timestamp)
    if (!Number.isFinite(time)) continue
    if (!spans.has(item.span_id)) spans.set(item.span_id, { span_id: item.span_id, capability: item.capability, start: time, end: time })
    spans.get(item.span_id).end = time
  }
  return {
    stage_timings: [...spans.values()].map(({ span_id, capability, start, end }) => ({
      span_id, capability, recorded_duration_ms: Math.max(0, end - start),
    })),
    resolved_config: chain.filter(item => item.stage === 'route' || item.stage === 'executor-config'),
    comfyui_status: chain.filter(item => item.stage === 'comfyui-status'),
    node_errors: chain.flatMap(item => item.node_errors || []),
  }
}
