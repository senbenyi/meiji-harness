// 职责：在单个任务内执行视频生成阶段，并处理有限网络重试。
import { ensureConnection } from '../servers/connection.js'
import { readBackend } from '../servers/backend.js'
import { withBackend } from '../servers/resolve.js'
import { runtimeConfig } from '../config.js'
import { setTimeout } from 'node:timers/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ComfyClient } from '../comfyui/client.js'
import { saveJson } from '../jobs/store.js'
import { codeVersion } from '../jobs/diagnostics.js'
import { buildVideoGraph } from './graph.js'
import { collectVideoArtifacts } from './artifacts.js'
import { prepareComfyWorkflow, runComfyWorkflow } from '../comfyui/execution.js'
import { createTiming } from '../jobs/timing.js'
import { projectJobRoot } from '../jobs/paths.js'

export async function executeComfyVideo(projectId, jobId, plan, options = {}) {
  const backend = await readBackend(projectJobRoot(projectId, jobId))
  await ensureConnection(backend)
  return withBackend(backend, () => executePinnedVideo(projectId, jobId, plan, options))
}

async function executePinnedVideo(projectId, jobId, plan, { signal, timeoutMs = 451 * 60_000, pause = setTimeout } = {}) {
  const directory = projectJobRoot(projectId, jobId)
  const statusPath = join(directory, 'status.json')
  const timing = createTiming(), client = new ComfyClient(undefined, signal, timing)
  const status = { job_id: jobId, project_id: projectId, capability: 'workflow-video', backend: 'comfyui', server: runtimeConfig().ELYSIUM_BACKEND, trace_id: jobId,
    parent_job_id: null, status: 'running', stage: 'prepare', created_at: new Date().toISOString(),
    code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } }
  await saveJson(statusPath, status)
  for (let attempt = 0; ; attempt++) try {
    status.stage = 'prepare'
    const prepared = await timing.measure('prepare', () => prepareComfyWorkflow(directory, client, plan, async () => ({
      ...await timing.measure('prepare.graph', () => buildVideoGraph(plan, jobId)), plan, server_url: client.url.href,
    })))
    const { promptId, history } = await timing.measure('remote', () => runComfyWorkflow(directory, client, prepared, status, timeoutMs))
    status.stage = 'inspect-output'
    await saveJson(statusPath, status)
    status.result = await timing.measure('output.inspect', () => collectVideoArtifacts(client, history, prepared, promptId))
    signal?.throwIfAborted()
    status.status = 'succeeded'
    status.stage = 'completed'
    status.finished_at = new Date().toISOString()
    await timing.measure('output.persist-validation', () => saveJson(join(directory, 'validation.json'), status.result.validation))
    status.timings = timing.snapshot()
    await saveJson(statusPath, status)
    await saveJson(status.debug.diagnostic_path, status)
    return status
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    const transient = error.name === 'TimeoutError' || error instanceof TypeError && error.message === 'fetch failed' || [408, 429, 502, 503, 504].includes(error.status)
    if (!signal?.aborted && transient && attempt < 5) {
      status.stage = 'reconnecting'
      status.retry_attempt = attempt + 1
      await saveJson(statusPath, status)
      try { await timing.measure('reconnect.backoff', () => pause(Math.min(30000, 2000 * 2 ** attempt), undefined, { signal })) } catch { error = signal.reason }
      if (!signal?.aborted) continue
    }
    status.failed_stage = status.stage
    status.stage = 'failed'
    status.status = 'failed'
    status.error_code = error.code || 'MODEL_GENERATION_FAILED'
    status.error = error.message.slice(0, 1000)
    status.recovery_instruction = '自动重试已停止。保留此 job_id，等待用户要求恢复；禁止改提示词重新生成或连续调用恢复工具。'
    status.retry_scope = 'query-existing-comfyui-prompt-before-retry'
    status.finished_at = new Date().toISOString()
    status.timings = timing.snapshot()
    await mkdir(directory, { recursive: true })
    await writeFile(status.debug.log_path, status.error + '\n', { flag: 'a' })
    await saveJson(statusPath, status)
    await saveJson(status.debug.diagnostic_path, status)
    throw error
  }
}
