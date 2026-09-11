import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { requiredConfig } from '../config.js'
import { ComfyClient } from '../functions/comfyui/client.js'
import { saveJson } from '../jobs/json.js'
import { codeVersion } from '../functions/common/diagnostics.js'
import { buildVideoGraph } from './video-graph.js'
import { collectVideoArtifacts } from './video-artifacts.js'
import { prepareComfyWorkflow, runComfyWorkflow } from './comfy-execution.js'

export async function executeComfyVideo(jobId, plan, { signal, timeoutMs = 451 * 60_000 } = {}) {
  const directory = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', jobId)
  const statusPath = join(directory, 'status.json')
  const client = new ComfyClient(undefined, signal), started = Date.now()
  const status = { job_id: jobId, capability: 'workflow-video', backend: 'comfyui', trace_id: jobId,
    parent_job_id: null, status: 'running', stage: 'prepare', created_at: new Date().toISOString(),
    code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } }
  await saveJson(statusPath, status)
  try {
    const prepared = await prepareComfyWorkflow(directory, client, plan, async () => ({
      ...await buildVideoGraph(plan, jobId), plan, server_url: client.url.href,
    }))
    const { promptId, history } = await runComfyWorkflow(directory, client, prepared, status, timeoutMs)
    status.stage = 'inspect-output'
    await saveJson(statusPath, status)
    status.result = await collectVideoArtifacts(client, history, prepared, promptId)
    signal?.throwIfAborted()
    status.status = 'succeeded'
    status.stage = 'completed'
    status.timings = { total_ms: Date.now() - started }
    status.finished_at = new Date().toISOString()
    await saveJson(join(directory, 'validation.json'), status.result.validation)
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
