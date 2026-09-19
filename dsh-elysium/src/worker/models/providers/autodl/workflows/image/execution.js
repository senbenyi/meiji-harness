// 职责：在任务快照绑定的 AutoDL ComfyUI 上执行图片工作流并保留可恢复状态。
import { join } from 'node:path'
import { createBackendClient } from '../../../../managers/runtime/index.js'
import { projectJobRoot } from '../../../../../tasks/jobs/paths.js'
import { saveJson } from '../../../../../../database/json.js'
import { failStatus, saveStatus, startStatus, succeedStatus } from '../../../../../tasks/jobs/status.js'
import { codeVersion } from '../../../../../tasks/jobs/diagnostics.js'
import { prepareComfyWorkflow, runComfyWorkflow } from '../../../../protocols/comfyui/execution.js'
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { buildImageGraph } from './graph.js'
import { collectImageArtifacts } from './artifacts.js'
import { normalizeImagePlan } from './plan.js'
import { probeImage } from './probe.js'

export async function executeComfyImage(projectId, jobId, input, backend, { signal, timeoutMs = 121 * 60_000 } = {}) {
  const plan = normalizeImagePlan(input)
  const directory = projectJobRoot(projectId, jobId)
  const client = await createBackendClient(backend, { signal })
  const status = await startStatus(directory, { job_id: jobId, project_id: projectId, capability: 'workflow-image', backend: 'comfyui', server: backend,
    trace_id: jobId, parent_job_id: null, code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } })
  try {
    const prepared = await prepareComfyWorkflow(directory, client, plan, async () => {
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
    })
    const { promptId, history } = await runComfyWorkflow(directory, client, prepared, status, timeoutMs)
    status.stage = 'inspect-output'
    await saveStatus(directory, status)
    const result = await collectImageArtifacts(client, history, prepared, promptId)
    signal?.throwIfAborted()
    await saveJson(join(directory, 'validation.json'), result.validation)
    return succeedStatus(directory, status, result)
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    await failStatus(directory, status, error, { code: 'MODEL_GENERATION_FAILED', retry_scope: 'query-existing-comfyui-prompt-before-retry',
      recovery_instruction: '保留此 job_id，恢复时查询原 prompt_id；禁止修改提示词重建任务。' })
    throw error
  }
}
