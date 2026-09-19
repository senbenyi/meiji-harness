// 职责：执行 main 分支 AutoDL H3 导演计划，并沿用当前任务快照和恢复协议。
import { join } from 'node:path'
import { createBackendClient } from '../../../../managers/runtime/index.js'
import { projectJobRoot } from '../../../../../tasks/jobs/paths.js'
import { saveJson } from '../../../../../../database/json.js'
import { failStatus, saveStatus, startStatus, succeedStatus } from '../../../../../tasks/jobs/status.js'
import { codeVersion } from '../../../../../tasks/jobs/diagnostics.js'
import { prepareComfyWorkflow, runComfyWorkflow } from '../../../../protocols/comfyui/execution.js'
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { buildVideoGraph, loadVideoTemplates } from './director.js'
import { collectDirectorArtifacts } from './artifacts.js'
import { probeVideoInput } from './probe.js'

const sources = plan => [...new Set([...(plan.video_paths || []), plan.image_path,
  ...(plan.shots || []).flatMap(shot => [shot.image_path, shot.video_path, shot.audio_path])].filter(Boolean))]

export async function executeDirectorVideo(projectId, jobId, plan, backend, { signal, timeoutMs = 451 * 60_000 } = {}) {
  const directory = projectJobRoot(projectId, jobId)
  const client = await createBackendClient(backend, { signal })
  const status = await startStatus(directory, { job_id: jobId, project_id: projectId, capability: 'workflow-video', backend: 'comfyui', server: backend,
    trace_id: jobId, parent_job_id: null, code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } })
  try {
    const prepared = await prepareComfyWorkflow(directory, client, plan, async () => {
      const media = {}, reused = new Set(plan.video_paths || (plan.shots || []).filter(shot => shot.mode === 'reuse').map(shot => shot.video_path))
      for (const path of sources(plan)) {
        const reference = mediaReference(path)
        media[path] = reused.has(path) ? await probeVideoInput(path) : { name: reference.name }
      }
      return { ...buildVideoGraph(plan, media, await loadVideoTemplates(), jobId), media, plan, server_url: client.url.href }
    })
    const { promptId, history } = await runComfyWorkflow(directory, client, prepared, status, timeoutMs)
    status.stage = 'inspect-output'; await saveStatus(directory, status)
    const result = await collectDirectorArtifacts(client, history, prepared, promptId)
    signal?.throwIfAborted()
    await saveJson(join(directory, 'validation.json'), { shots: result.shots, validation: result.validation })
    return succeedStatus(directory, status, result)
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    await failStatus(directory, status, error, { code: 'MODEL_GENERATION_FAILED', retry_scope: 'query-existing-comfyui-prompt-before-retry',
      recovery_instruction: '保留此 job_id，恢复时查询原 prompt_id；禁止修改分镜后重建任务。' })
    throw error
  }
}
