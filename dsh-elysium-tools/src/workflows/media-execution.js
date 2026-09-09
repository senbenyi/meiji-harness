import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, rename } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { requiredConfig } from '../config.js'
import { ComfyClient, readJson, saveJson } from '../functions/comfyui/client.js'
import { inspectMedia } from '../functions/common/diagnostics.js'
import { buildMediaGraph } from './media-graph.js'

const run = promisify(execFile)
async function digest(path) {
  const hash = createHash('sha256')
  for await (const data of createReadStream(path)) hash.update(data)
  return hash.digest('hex')
}
async function probe(path, report) {
  const result = await inspectMedia(path, report)
  if (!result.media_info) throw new Error('无法验证素材规格')
  const info = result.media_info
  if (extname(path) === '.mp4') {
    const data = await readJson(report), video = data.streams.find(s => s.codec_type === 'video')
    info.duration_seconds = Number(video.duration)
    const audio = data.streams.find(s => s.codec_type === 'audio')
    if (audio && (!Number.isFinite(Number(audio.duration)) || Math.abs(Number(audio.duration) - info.duration_seconds) > 0.15)) throw new Error('音轨与视频时长不一致')
    if (!(info.duration_seconds > 0) || !(info.frame_rate > 0)) throw new Error('视频缺少有效时间基准')
    const { stdout } = await run(process.env.FFPROBE_BIN || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path], { timeout: 120000, maxBuffer: 32 * 1024 * 1024 })
    const frames = JSON.parse(stdout).frames.map(f => Number(f.best_effort_timestamp_time))
    if (!frames.length || frames.some((t, i) => !Number.isFinite(t) || Math.abs(t - frames[0] - i / info.frame_rate) > 0.002)) throw new Error('合片要求恒定帧率，不能丢失原始帧时间')
  }
  return info
}
export async function executeComfyMedia(jobId, plan) {
  const directory = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', jobId)
  const statusPath = join(directory, 'status.json'), client = new ComfyClient()
  const status = { job_id: jobId, capability: 'workflow-media', backend: 'comfyui', status: 'running', stage: 'prepare', created_at: new Date().toISOString(), debug: { effective_input: plan } }
  await saveJson(statusPath, status)
  try {
    let prepared = await readJson(join(directory, 'comfyui-workflow.json'))
    if (!prepared) {
      const media = {}, paths = plan.capability === 'image-generate' ? [plan.params.image_path].filter(Boolean) : plan.params.video_paths
      for (const path of new Set(paths)) {
        const sha = await digest(path)
        media[path] = { info: await probe(path, join(directory, `input-${sha}.json`)), name: await client.upload(path, `${jobId}-${sha}${extname(path)}`) }
      }
      prepared = { ...await buildMediaGraph(plan, media, jobId), server_url: client.url.href }
      await client.validate(prepared.graph)
      await saveJson(join(directory, 'comfyui-workflow.json'), prepared)
    }
    if (JSON.stringify(plan) !== JSON.stringify(prepared.plan) || client.url.href !== prepared.server_url) throw new Error('恢复请求或后端与原任务不一致')
    await saveJson(join(directory, 'comfyui-workflow-ui.json'), prepared.workflow)
    status.workflow_name = prepared.workflowName; status.stage = 'submit'
    await saveJson(statusPath, status)
    const resume = await readJson(join(directory, 'resume-request.json'))
    const promptId = await client.submit(prepared.graph, jobId, join(directory, 'comfyui-submission.json'), resume?.retry_failed === true, prepared.workflow)
    await saveJson(join(directory, 'resume-request.json'), { retry_failed: false })
    status.comfyui_prompt_id = promptId; status.stage = 'execute'
    await saveJson(statusPath, status)
    const history = await client.wait(promptId, 2 * 60 * 60 * 1000, async (_, stage) => {
      if (status.stage !== stage) { status.stage = stage; await saveJson(statusPath, status) }
    })
    await saveJson(join(directory, 'comfyui-history.json'), history)
    const expected = prepared.expected, extension = expected.kind === 'image' ? '.png' : '.mp4'
    const descriptor = Object.values(history.outputs?.['7'] || {}).flat().find(v => v?.filename?.endsWith(extension) && v.type === 'output')
    if (!descriptor) throw new Error('最终节点没有返回所需产物')
    status.stage = 'inspect-output'; await saveJson(statusPath, status)
    const output = join(requiredConfig('ARTIFACTS_ROOT'), `production-${jobId}`, `output/final${extension}`), candidate = output.replace(extension, `.candidate${extension}`)
    await client.download(descriptor, candidate)
    const info = await probe(candidate, join(directory, 'media-probe.json'))
    if (info.width !== expected.width || info.height !== expected.height || (expected.kind === 'video' && (Math.abs(info.duration_seconds - expected.duration_seconds) > 0.15 || Math.abs(info.frame_rate - expected.frame_rate) > 0.001 || info.has_audio !== expected.has_audio))) throw new Error('产物尺寸、时长、帧率或音轨不匹配')
    await run(process.env.FFMPEG_BIN || 'ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', candidate, '-f', 'null', '-'], { timeout: 300000 })
    await rename(candidate, output)
    status.result = { path: output, size_bytes: (await stat(output)).size, sha256: await digest(output), media_kind: expected.kind, media_info: info, warnings: [],
      validation: { full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' },
      comfyui_prompt_id: promptId, comfyui_view_url: client.viewUrl(descriptor, requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')),
      comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [{ ...descriptor, prompt_id: promptId }] }
    status.status = 'succeeded'; status.stage = 'completed'
  } catch (error) {
    status.failed_stage = status.stage; status.stage = 'failed'; status.status = 'failed'
    status.error_code = error.code || 'MODEL_GENERATION_FAILED'; status.error = error.message.slice(0, 1500)
    status.retry_scope = 'query-existing-comfyui-prompt-before-retry'
  }
  status.finished_at = new Date().toISOString()
  await saveJson(statusPath, status)
  return status
}
