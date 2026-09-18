// 职责：执行 main 分支 AutoDL H3 导演计划，并沿用当前任务快照和恢复协议。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBackendClient } from '../../../../managers/runtime/index.js'
import { projectJobRoot } from '../../../../../server/jobs/paths.js'
import { saveJson } from '../../../../../database/json.js'
import { codeVersion } from '../../../../../server/jobs/diagnostics.js'
import { createTiming } from '../../../../../server/jobs/timing.js'
import { prepareComfyWorkflow, runComfyWorkflow } from '../../../../protocols/comfyui/execution.js'
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { buildVideoGraph, loadVideoTemplates } from './director.js'
import { collectDirectorArtifacts } from './artifacts.js'
import { probeVideoInput } from './probe.js'

const sources = plan => [...new Set([...(plan.video_paths || []), plan.image_path,
  ...(plan.shots || []).flatMap(shot => [shot.image_path, shot.video_path, shot.audio_path])].filter(Boolean))]

export async function executeDirectorVideo(projectId, jobId, plan, backend, { signal, timeoutMs = 451 * 60_000 } = {}) {
  const directory = projectJobRoot(projectId, jobId), statusPath = join(directory, 'status.json')
  const timing = createTiming(), client = await createBackendClient(backend, { signal, timing })
  const status = { job_id: jobId, project_id: projectId, capability: 'workflow-video', backend: 'comfyui', server: backend,
    trace_id: jobId, parent_job_id: null, status: 'running', stage: 'prepare', created_at: new Date().toISOString(),
    code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } }
  await saveJson(statusPath, status)
  try {
    const prepared = await timing.measure('prepare', () => prepareComfyWorkflow(directory, client, plan, async () => {
      const media = {}, reused = new Set(plan.video_paths || (plan.shots || []).filter(shot => shot.mode === 'reuse').map(shot => shot.video_path))
      for (const path of sources(plan)) {
        const reference = mediaReference(path)
        media[path] = reused.has(path) ? await probeVideoInput(path) : { name: reference.name }
      }
      return { ...buildVideoGraph(plan, media, await loadVideoTemplates(), jobId), media, plan, server_url: client.url.href }
    }))
    const { promptId, history } = await timing.measure('remote', () => runComfyWorkflow(directory, client, prepared, status, timeoutMs))
    status.stage = 'inspect-output'; await saveJson(statusPath, status)
    status.result = await timing.measure('output.inspect', () => collectDirectorArtifacts(client, history, prepared, promptId))
    signal?.throwIfAborted()
    status.status = 'succeeded'; status.stage = 'completed'; status.finished_at = new Date().toISOString(); status.timings = timing.snapshot()
    await saveJson(join(directory, 'validation.json'), { shots: status.result.shots, validation: status.result.validation })
    await saveJson(statusPath, status); await saveJson(status.debug.diagnostic_path, status)
    return status
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    status.failed_stage = status.stage; status.stage = 'failed'; status.status = 'failed'
    status.error_code = error.code || 'MODEL_GENERATION_FAILED'; status.error = error.message.slice(0, 1000)
    status.recovery_instruction = '保留此 job_id，恢复时查询原 prompt_id；禁止修改分镜后重建任务。'
    status.retry_scope = 'query-existing-comfyui-prompt-before-retry'; status.finished_at = new Date().toISOString(); status.timings = timing.snapshot()
    await mkdir(directory, { recursive: true }); await writeFile(status.debug.log_path, status.error + '\n', { flag: 'a' })
    await saveJson(statusPath, status); await saveJson(status.debug.diagnostic_path, status)
    throw error
  }
}
