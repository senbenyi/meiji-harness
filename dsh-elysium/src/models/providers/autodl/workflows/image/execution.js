// 职责：在任务快照绑定的 AutoDL ComfyUI 上执行图片工作流并保留可恢复状态。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBackendClient } from '../../../../managers/runtime/index.js'
import { projectJobRoot } from '../../../../../server/jobs/paths.js'
import { saveJson } from '../../../../../database/json.js'
import { codeVersion } from '../../../../../server/jobs/diagnostics.js'
import { createTiming } from '../../../../../server/jobs/timing.js'
import { prepareComfyWorkflow, runComfyWorkflow } from '../../../../protocols/comfyui/execution.js'
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { buildImageGraph } from './graph.js'
import { collectImageArtifacts } from './artifacts.js'
import { normalizeImagePlan } from './plan.js'
import { probeImage } from './probe.js'

export async function executeComfyImage(projectId, jobId, input, backend, { signal, timeoutMs = 121 * 60_000 } = {}) {
  const plan = normalizeImagePlan(input)
  const directory = projectJobRoot(projectId, jobId), statusPath = join(directory, 'status.json')
  const timing = createTiming(), client = await createBackendClient(backend, { signal, timing })
  const status = { job_id: jobId, project_id: projectId, capability: 'workflow-image', backend: 'comfyui', server: backend,
    trace_id: jobId, parent_job_id: null, status: 'running', stage: 'prepare', created_at: new Date().toISOString(),
    code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } }
  await saveJson(statusPath, status)
  try {
    const prepared = await timing.measure('prepare', () => prepareComfyWorkflow(directory, client, plan, async () => {
      const media = {}, paths = plan.capability === 'image-generate'
        ? [plan.params.image_path].filter(Boolean) : plan.params.views.map(view => view.path)
      for (const path of new Set(paths)) {
        const reference = mediaReference(path, ['.png', '.jpg', '.jpeg', '.webp'])
        media[path] = { name: reference.name, ...(plan.capability === 'image-compose' ? { info: await probeImage(path) } : {}) }
      }
      if (plan.capability === 'image-generate' && plan.params.character) {
        media.pose = { name: `elysium/poses/${plan.params.character.view}.png [input]` }
      }
      return { ...await buildImageGraph(plan, media, jobId), server_url: client.url.href }
    }))
    const { promptId, history } = await timing.measure('remote', () => runComfyWorkflow(directory, client, prepared, status, timeoutMs))
    status.stage = 'inspect-output'
    await saveJson(statusPath, status)
    status.result = await timing.measure('output.inspect', () => collectImageArtifacts(client, history, prepared, promptId))
    signal?.throwIfAborted()
    status.status = 'succeeded'; status.stage = 'completed'; status.finished_at = new Date().toISOString()
    status.timings = timing.snapshot()
    await saveJson(join(directory, 'validation.json'), status.result.validation)
    await saveJson(statusPath, status)
    await saveJson(status.debug.diagnostic_path, status)
    return status
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    status.failed_stage = status.stage; status.stage = 'failed'; status.status = 'failed'
    status.error_code = error.code || 'MODEL_GENERATION_FAILED'; status.error = error.message.slice(0, 1000)
    status.recovery_instruction = '保留此 job_id，恢复时查询原 prompt_id；禁止修改提示词重建任务。'
    status.retry_scope = 'query-existing-comfyui-prompt-before-retry'; status.finished_at = new Date().toISOString()
    status.timings = timing.snapshot()
    await mkdir(directory, { recursive: true })
    await writeFile(status.debug.log_path, status.error + '\n', { flag: 'a' })
    await saveJson(statusPath, status)
    await saveJson(status.debug.diagnostic_path, status)
    throw error
  }
}
