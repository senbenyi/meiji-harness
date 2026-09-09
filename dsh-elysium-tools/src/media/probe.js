import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname } from 'node:path'
import { readJson } from '../jobs/json.js'
import { inspectMedia } from '../functions/common/diagnostics.js'

const run = promisify(execFile)

export async function probeVideoInput(path) {
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

export async function probeMedia(path, report) {
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
