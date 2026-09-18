// 职责：按展示时间读取导演工作流复用视频的帧时间和音轨信息。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mediaReference } from '../../../../../comfyui/media-reference.js'

const run = promisify(execFile)

export async function probeVideoInput(path) {
  const url = mediaReference(path, ['.mp4', '.mov', '.webm', '.mkv']).url
  const common = ['-protocol_whitelist', 'http,https,tcp,tls,crypto', '-v', 'error']
  const { stdout } = await run('ffprobe', [...common, '-show_streams', '-show_format', '-of', 'json', url],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  const data = JSON.parse(stdout), video = data.streams?.find(stream => stream.codec_type === 'video')
  const [n, d] = String(video?.avg_frame_rate).split('/').map(Number)
  const duration = Number(video?.duration || data.format?.duration), fps = n / d
  if (!video || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) throw new Error('素材没有有效的视频时长与帧率')
  const frames = await run('ffprobe', [...common, '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', url],
    { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 })
  const timestamps = JSON.parse(frames.stdout).frames?.map(frame => Number(frame.best_effort_timestamp_time)) || []
  if (!timestamps.length || timestamps.some(value => !Number.isFinite(value))) throw new Error('无法读取素材帧时间戳')
  const first = timestamps[0]
  return { name: mediaReference(path).name, duration, fps, timestamps: timestamps.map(value => value - first), hasAudio: data.streams.some(stream => stream.codec_type === 'audio') }
}
