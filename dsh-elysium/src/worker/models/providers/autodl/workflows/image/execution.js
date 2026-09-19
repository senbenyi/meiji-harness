// 职责：声明 AutoDL 图片工作流的准备与产物收集，执行流程由 ComfyUI runner 统一负责。
import { runComfyJob } from '../../../../protocols/comfyui/runner.js'
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { buildImageGraph } from './graph.js'
import { collectImageArtifacts } from './artifacts.js'
import { normalizeImagePlan } from './plan.js'
import { probeImage } from './probe.js'

export function executeComfyImage(input, backend, ctx) {
  const plan = normalizeImagePlan(input)
  return runComfyJob(plan, backend, ctx, { capability: 'workflow-image', timeoutMs: 121 * 60_000, collect: collectImageArtifacts,
    recovery: '保留此 job_id，恢复时查询原 prompt_id；禁止修改提示词重建任务。',
    async prepare(client) {
      const media = {}, paths = plan.capability === 'image-generate'
        ? [plan.params.image_path].filter(Boolean) : plan.params.views.map(view => view.path)
      for (const path of new Set(paths)) {
        const reference = mediaReference(path, ['.png', '.jpg', '.jpeg', '.webp'])
        media[path] = { name: reference.name, ...(plan.capability === 'image-compose' ? { info: await probeImage(path) } : {}) }
      }
      if (plan.capability === 'image-generate' && plan.params.character) {
        media.pose = { name: `elysium/poses/${plan.params.character.view}.png [input]` }
      }
      return { ...await buildImageGraph(plan, media, ctx.jobId), server_url: client.url.href }
    } })
}
