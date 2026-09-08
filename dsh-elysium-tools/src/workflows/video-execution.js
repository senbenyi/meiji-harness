import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { ComfyClient, readJson, saveJson } from '../functions/comfyui/client.js'
import { buildVideoGraph, loadVideoTemplates, VIDEO_SETTINGS } from './video-graph.js'
import { codeVersion, inspectMedia } from '../functions/common/diagnostics.js'

const run = promisify(execFile)
async function digest(path) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}

async function probeInput(path) {
  const { stdout } = await run(process.env.FFPROBE_BIN || 'ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  const data = JSON.parse(stdout), video = data.streams.find(s => s.codec_type === 'video')
  const [n, d] = String(video?.avg_frame_rate).split('/').map(Number)
  const duration = Number(video?.duration), fps = n / d
  if (!video || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) throw new Error('素材没有有效的视频时长与帧率')
  const frames = await run(process.env.FFPROBE_BIN || 'ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path,
  ], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 })
  const timestamps = JSON.parse(frames.stdout).frames.map(f => Number(f.best_effort_timestamp_time))
  if (!timestamps.length || timestamps.some(t => !Number.isFinite(t))) throw new Error('无法读取素材帧时间戳')
  const first = timestamps[0]
  return { duration, fps, timestamps: timestamps.map(t => t - first), hasAudio: data.streams.some(s => s.codec_type === 'audio') }
}

function sources(plan) {
  return [...new Set([...(plan.video_paths || []), plan.image_path,
    ...(plan.shots || []).flatMap(s => [s.image_path, s.video_path, s.audio_path])].filter(Boolean))]
}

export async function executeComfyVideo(jobId, plan, { signal, timeoutMs = 451 * 60_000 } = {}) {
  const stateRoot = process.env.ELYSIUM_TOOLS_STATE_ROOT || '/root/autodl-tmp/elysium-tools'
  const artifactsRoot = process.env.ARTIFACTS_ROOT || '/root/autodl-fs/artifacts/projects'
  const directory = join(stateRoot, 'jobs', jobId), output = join(artifactsRoot, `production-${jobId}`, 'output/final.mp4')
  const statusPath = join(directory, 'status.json'), submissionPath = join(directory, 'comfyui-submission.json')
  const client = new ComfyClient(undefined, signal), started = Date.now()
  const status = { job_id: jobId, capability: 'workflow-video', backend: 'comfyui', trace_id: jobId,
    parent_job_id: null, status: 'running', stage: 'prepare', created_at: new Date().toISOString(),
    code_version: await codeVersion(), debug: { effective_input: plan, chain: [],
      diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } }
  await saveJson(statusPath, status)
  try {
    let prepared = await readJson(join(directory, 'comfyui-workflow.json'))
    if (!prepared) {
      const media = {}, reused = new Set(plan.video_paths || (plan.shots || []).filter(s => s.mode === 'reuse').map(s => s.video_path))
      for (const path of sources(plan)) {
        const sha256 = await digest(path)
        media[path] = { sha256, ...(reused.has(path) ? await probeInput(path) : {}) }
        media[path].name = await client.upload(path, `${jobId}-${sha256}${extname(path).toLowerCase()}`)
      }
      prepared = { ...buildVideoGraph(plan, media, await loadVideoTemplates(), jobId), media, plan,
        settings: VIDEO_SETTINGS, server_url: client.url.href }
      await client.validate(prepared.graph)
      await saveJson(join(directory, 'comfyui-workflow.json'), prepared)
    }
    if (JSON.stringify(prepared.plan) !== JSON.stringify(plan) || prepared.server_url !== client.url.href) throw new Error('恢复请求或后端与原任务不一致')
    status.stage = 'submit'
    await saveJson(statusPath, status)
    const resume = await readJson(join(directory, 'resume-request.json'))
    const promptId = await client.submit(prepared.graph, jobId, submissionPath, resume?.retry_failed === true)
    await saveJson(join(directory, 'resume-request.json'), { retry_failed: false })
    status.comfyui_prompt_id = promptId
    status.debug.chain.push({ stage: 'comfyui-submitted', server_url: client.url.href, prompt_id: promptId })
    status.stage = 'execute'
    await saveJson(statusPath, status)
    const history = await client.wait(promptId, timeoutMs)
    await saveJson(join(directory, 'comfyui-history.json'), history)
    const descriptor = Object.values(history.outputs?.final || {}).flat().find(v => v?.filename?.endsWith('.mp4') && v.type === 'output')
    if (!descriptor) throw new Error('ComfyUI 没有返回最终节点的 MP4，不能用中间片段交付')
    status.stage = 'inspect-output'
    await saveJson(statusPath, status)
    const candidate = output.replace(/\.mp4$/, '.candidate.mp4')
    await client.download(descriptor, candidate)
    const inspection = await inspectMedia(candidate, join(directory, 'media-probe.json'))
    const m = inspection.media_info, settings = prepared.settings
    const measured = await readJson(join(directory, 'media-probe.json'))
    const videoDuration = Number(measured?.streams?.find(s => s.codec_type === 'video')?.duration)
    const audioDuration = Number(measured?.streams?.find(s => s.codec_type === 'audio')?.duration)
    if (!m || m.width !== settings.outputWidth || m.height !== settings.outputHeight ||
        Math.abs(m.frame_rate - settings.outputFps) > 0.001 || m.video_codec !== 'h264' ||
        !m.has_audio || m.audio_codec !== 'aac' || !Number.isFinite(videoDuration) || !Number.isFinite(audioDuration) ||
        Math.abs(audioDuration - videoDuration) > 0.15 ||
        Math.abs(videoDuration - plan.duration) > Math.max(0.5, prepared.shots.length * 0.05)) {
      throw new Error('成片未通过时长、画幅、帧率或音视频规格验证')
    }
    // Local binaries only verify the downloaded artifact; generation/editing run in ComfyUI.
    await run(process.env.FFMPEG_BIN || 'ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', candidate,
      '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { timeout: 300_000, maxBuffer: 1024 * 1024 })
    await rename(candidate, output)
    const sha256 = await digest(output), size = (await stat(output)).size
    const viewUrl = client.viewUrl(descriptor, process.env.MINIMAX_H3_COMFYUI_PUBLIC_URL || client.url.href)
    const artifact = { ...descriptor, server_url: client.url.href, prompt_id: promptId, view_url: viewUrl, local_path: output }
    const shots = []
    for (const [index, shot] of prepared.shots.entries()) {
      const file = Object.values(history.outputs?.[`s${index}_save`] || {}).flat().find(v => v?.filename?.endsWith('.mp4') && v.type === 'output')
      if (!file) throw new Error(`缺少镜头 ${shot.id} 的可复用产物`)
      const path = join(artifactsRoot, `production-${jobId}`, 'shots', `${shot.id}.mp4`)
      await client.download(file, path)
      shots.push({ id: shot.id, duration: shot.duration, path,
        comfyui_view_url: client.viewUrl(file, process.env.MINIMAX_H3_COMFYUI_PUBLIC_URL || client.url.href) })
    }
    status.result = { path: output, size_bytes: size, sha256, media_info: m,
      validation: { file_exists: 'passed', nonempty: 'passed', media_probe: 'passed', full_decode: 'passed',
        specification_match: 'passed', human_review: 'not_run' },
      shots, warnings: [],
      comfyui_prompt_id: promptId, comfyui_artifact_id: createHash('sha256').update(JSON.stringify([client.url.href, promptId, 'final', descriptor])).digest('hex'), comfyui_view_url: viewUrl,
      comfyui_metadata_status: 'comfyui-final', comfyui_artifacts: [artifact] }
    status.status = 'succeeded'
    status.stage = 'completed'
    status.timings = { total_ms: Date.now() - started }
    status.finished_at = new Date().toISOString()
    await saveJson(`${output}.validation.json`, { shots: status.result.shots, validation: status.result.validation })
    await saveJson(statusPath, status)
    await saveJson(status.debug.diagnostic_path, status)
    return status
  } catch (error) {
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
