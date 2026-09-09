import { runtimeConfig } from '../config.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { summarizeMedia } from '../functions/common/diagnostics.js'
import { mediaReference } from './http-media.js'

const run = promisify(execFile)

export async function probeVideoInput(path) {
  path = mediaReference(path).url
  const { stdout } = await run(runtimeConfig().FFPROBE_BIN || 'ffprobe', [
    '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  const data = JSON.parse(stdout), video = data.streams.find(s => s.codec_type === 'video')
  const [n, d] = String(video?.avg_frame_rate).split('/').map(Number)
  const duration = Number(video?.duration), fps = n / d
  if (!video || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) throw new Error('素材没有有效的视频时长与帧率')
  const frames = await run(runtimeConfig().FFPROBE_BIN || 'ffprobe', [
    '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path,
  ], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 })
  const timestamps = JSON.parse(frames.stdout).frames.map(f => Number(f.best_effort_timestamp_time))
  if (!timestamps.length || timestamps.some(t => !Number.isFinite(t))) throw new Error('无法读取素材帧时间戳')
  const first = timestamps[0]
  return { duration, fps, timestamps: timestamps.map(t => t - first), hasAudio: data.streams.some(s => s.codec_type === 'audio') }
}

export async function probeMedia(path) {
  path = mediaReference(path).url
  const { stdout } = await run(runtimeConfig().FFPROBE_BIN || 'ffprobe', [
    '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  const data = JSON.parse(stdout), info = summarizeMedia(data)
  if (!(info.width > 0) || !(info.height > 0)) throw new Error('无法读取 HTTP 素材尺寸')
  if (new URL(path).searchParams.get('filename')?.endsWith('.mp4')) {
    const timing = await probeVideoInput(path)
    info.duration_seconds = timing.duration
    const audio = data.streams.find(s => s.codec_type === 'audio')
    if (audio && (!Number.isFinite(Number(audio.duration)) || Math.abs(Number(audio.duration) - info.duration_seconds) > 0.15)) throw new Error('音轨与视频时长不一致')
    if (timing.timestamps.some((t, i) => Math.abs(t - i / timing.fps) > 0.002)) throw new Error('合片要求恒定帧率，不能丢失原始帧时间')
  }
  return info
}
