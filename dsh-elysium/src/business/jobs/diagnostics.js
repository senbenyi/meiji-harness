// 职责：生成视频执行代码指纹，并汇总已持久化的执行跟踪。
import { createHash } from 'node:crypto'
import { runtimeConfig } from '../../config.js'
import { providerSourceFiles, runtimeSourceFiles } from '../../servers/runtime/index.js'
import { readFile } from 'node:fs/promises'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function codeVersion() {
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'))
  // 显式列出所有参与视频执行的模块，避免指纹漏掉恢复语义变更。
  const names = ['diagnostics.js', 'errors.js', 'create.js', 'store.js', 'query.js', 'wait.js', 'timing.js',
    '../../config.js', '../../tools/output.js', '../../tools/video.js', '../../comfyui/client.js', '../../comfyui/submission.js',
    '../../comfyui/plan.js', '../../comfyui/reference-frame.js', '../../comfyui/execution.js', '../../comfyui/media-reference.js',
    ...['artifacts', 'call-binding', 'execution', 'launcher', 'plan', 'service', 'worker-owner', 'worker'].map(name => `../video/${name}.js`)]
  const provider = runtimeConfig().ELYSIUM_BACKEND?.provider
  const adapterSources = provider ? await Promise.all((await providerSourceFiles(provider)).map(url => readFile(url))) : []
  const sources = await Promise.all([...names.map(name => new URL(name, import.meta.url)), ...await runtimeSourceFiles()].map(url => readFile(url)))
  return { plugin_version: pkg.version, executor_sha256: hash(Buffer.concat([...sources, ...adapterSources])) }
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
