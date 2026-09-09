import { sha256File } from '../functions/common/file-hash.js'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requiredConfig } from '../config.js'
import { ComfyClient } from '../functions/comfyui/client.js'
import { saveJson } from '../jobs/json.js'
import { probeMedia } from '../media/probe.js'
import { collectMediaArtifacts } from './media-artifacts.js'
import { prepareComfyWorkflow, runComfyWorkflow } from './comfy-execution.js'
import { buildMediaGraph } from './media-graph.js'

export async function executeComfyMedia(jobId, plan, { signal } = {}) {
  const directory = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', jobId)
  const statusPath = join(directory, 'status.json'), client = new ComfyClient(undefined, signal)
  const status = { job_id: jobId, capability: 'workflow-media', backend: 'comfyui', status: 'running', stage: 'prepare', created_at: new Date().toISOString(), debug: { effective_input: plan } }
  await saveJson(statusPath, status)
  try {
    const prepared = await prepareComfyWorkflow(directory, client, plan, async () => {
      const media = {}, paths = plan.capability === 'image-generate' ? [plan.params.image_path].filter(Boolean) : plan.capability === 'image-compose' ? plan.params.views.map(v => v.path) : plan.params.video_paths
      for (const path of new Set(paths)) {
        const sha = await sha256File(path)
        media[path] = { info: await probeMedia(path, join(directory, `input-${sha}.json`)), name: await client.upload(path, `${jobId}-${sha}${extname(path)}`) }
      }
      if (plan.capability === 'image-generate' && plan.params.character) {
        const view = plan.params.character.view
        if (!['front', 'side', 'back'].includes(view)) throw new Error('Invalid character view')
        const path = fileURLToPath(new URL(`./templates/poses/${view}.png`, import.meta.url))
        media.pose = { name: await client.upload(path, `character-${view}-${await sha256File(path)}.png`) }
      }
      return { ...await buildMediaGraph(plan, media, jobId), server_url: client.url.href }
    })
    const { promptId, history } = await runComfyWorkflow(directory, client, prepared, status, 2 * 60 * 60 * 1000)
    status.stage = 'inspect-output'
    await saveJson(statusPath, status)
    status.result = await collectMediaArtifacts(client, history, prepared, jobId, directory, promptId)
    signal?.throwIfAborted()
    status.status = 'succeeded'; status.stage = 'completed'
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    status.failed_stage = status.stage; status.stage = 'failed'; status.status = 'failed'
    status.error_code = error.code || 'MODEL_GENERATION_FAILED'; status.error = error.message.slice(0, 1500)
    status.retry_scope = 'query-existing-comfyui-prompt-before-retry'
  }
  status.finished_at = new Date().toISOString()
  await saveJson(statusPath, status)
  return status
}
