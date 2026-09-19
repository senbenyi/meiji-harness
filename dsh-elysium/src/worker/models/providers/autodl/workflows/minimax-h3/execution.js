// 职责：声明 main 分支 AutoDL H3 导演计划的准备与产物收集，执行流程由 ComfyUI runner 统一负责。
import { runComfyJob } from '../../../../protocols/comfyui/runner.js'
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { buildVideoGraph, loadVideoTemplates } from './director.js'
import { collectDirectorArtifacts } from './artifacts.js'
import { probeVideoInput } from './probe.js'

const sources = plan => [...new Set([...(plan.video_paths || []), plan.image_path,
  ...(plan.shots || []).flatMap(shot => [shot.image_path, shot.video_path, shot.audio_path])].filter(Boolean))]

export function executeDirectorVideo(plan, backend, ctx) {
  return runComfyJob(plan, backend, ctx, { capability: 'workflow-video', timeoutMs: 451 * 60_000, collect: collectDirectorArtifacts,
    validation: result => ({ shots: result.shots, validation: result.validation }),
    recovery: '保留此 job_id，恢复时查询原 prompt_id；禁止修改分镜后重建任务。',
    async prepare(client) {
      const media = {}, reused = new Set(plan.video_paths || (plan.shots || []).filter(shot => shot.mode === 'reuse').map(shot => shot.video_path))
      for (const path of sources(plan)) {
        const reference = mediaReference(path)
        media[path] = reused.has(path) ? await probeVideoInput(path) : { name: reference.name }
      }
      return { ...buildVideoGraph(plan, media, await loadVideoTemplates(), ctx.jobId), media, plan, server_url: client.url.href }
    } })
}
