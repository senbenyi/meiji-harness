import { requiredConfig } from '../config.js'
import { sha256File } from '../functions/common/file-hash.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { ComfyClient } from '../functions/comfyui/client.js'
import { saveJson } from '../jobs/json.js'
import { buildVideoGraph, loadVideoTemplates } from './video-graph.js'
import { codeVersion } from '../functions/common/diagnostics.js'
import { collectVideoArtifacts } from './video-artifacts.js'
import { probeVideoInput } from '../media/probe.js'
import { prepareComfyWorkflow, runComfyWorkflow } from './comfy-execution.js'
import { prepareVideoReferences } from './video-reference.js'

function sources(plan) {
  return [...new Set([...(plan.video_paths || []), plan.image_path,
    ...(plan.shots || []).flatMap(s => [s.image_path, s.video_path, s.audio_path])].filter(Boolean))]
}

export async function executeComfyVideo(jobId, plan, { signal, timeoutMs = 451 * 60_000 } = {}) {
  requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')
  const stateRoot = requiredConfig('ELYSIUM_TOOLS_STATE_ROOT')
  const artifactsRoot = requiredConfig('ARTIFACTS_ROOT')
  const directory = join(stateRoot, 'jobs', jobId), output = join(artifactsRoot, `production-${jobId}`, 'output/final.mp4')
  const statusPath = join(directory, 'status.json')
  const client = new ComfyClient(undefined, signal), started = Date.now()
  const status = { job_id: jobId, capability: 'workflow-video', backend: 'comfyui', trace_id: jobId,
    parent_job_id: null, status: 'running', stage: 'prepare', created_at: new Date().toISOString(),
    code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } }
  await saveJson(statusPath, status)
  try {
    const prepared = await prepareComfyWorkflow(directory, client, plan, async () => {
      const { effective, references } = await prepareVideoReferences(plan, join(directory, 'references'), signal)
      const media = {}, reused = new Set(plan.video_paths || (plan.shots || []).filter(s => s.mode === 'reuse').map(s => s.video_path))
      for (const path of sources(effective)) {
        const sha256 = await sha256File(path)
        media[path] = { sha256, ...(reused.has(path) ? await probeVideoInput(path) : {}) }
        media[path].name = await client.upload(path, `${jobId}-${sha256}${extname(path).toLowerCase()}`)
      }
      return { ...buildVideoGraph(effective, media, await loadVideoTemplates(), jobId), media, plan, references,
        server_url: client.url.href }
    })
    const { promptId, history } = await runComfyWorkflow(directory, client, prepared, status, timeoutMs)
    status.stage = 'inspect-output'
    await saveJson(statusPath, status)
    status.result = await collectVideoArtifacts(client, history, prepared, jobId, directory, output, promptId)
    signal?.throwIfAborted()
    status.status = 'succeeded'
    status.stage = 'completed'
    status.timings = { total_ms: Date.now() - started }
    status.finished_at = new Date().toISOString()
    await saveJson(`${output}.validation.json`, { shots: status.result.shots, validation: status.result.validation })
    await saveJson(statusPath, status)
    await saveJson(status.debug.diagnostic_path, status)
    return status
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    status.failed_stage = status.stage
    status.stage = 'failed'
    status.status = 'failed'
    status.error_code = error.code || 'MODEL_GENERATION_FAILED'
    status.error = error.message.slice(0, 1000)
    status.retry_scope = 'query-existing-comfyui-prompt-before-retry'
    status.finished_at = new Date().toISOString()
    await mkdir(directory, { recursive: true })
    await writeFile(status.debug.log_path, status.error + '\n', { flag: 'a' })
    await saveJson(statusPath, status)
    await saveJson(status.debug.diagnostic_path, status)
    throw error
  }
}
