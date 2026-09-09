import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readJson } from '../jobs/json.js'
import { inspectMedia } from '../functions/common/diagnostics.js'

const run = promisify(execFile)

export async function validateVideoArtifact(path, duration, settings, report, tolerance = 1 / settings.outputFps + 0.01) {
  const inspection = await inspectMedia(path, report)
  const media = inspection.media_info, measured = await readJson(report)
  const videoDuration = Number(measured?.streams?.find(s => s.codec_type === 'video')?.duration)
  const audioDuration = Number(measured?.streams?.find(s => s.codec_type === 'audio')?.duration)
  if (!media || media.width !== settings.outputWidth || media.height !== settings.outputHeight ||
      Math.abs(media.frame_rate - settings.outputFps) > 0.001 || media.video_codec !== 'h264' ||
      !media.has_audio || media.audio_codec !== 'aac' || !Number.isFinite(videoDuration) || !Number.isFinite(audioDuration) ||
      Math.abs(audioDuration - videoDuration) > 0.15 || Math.abs(videoDuration - duration) > tolerance) {
    throw new Error('产物未通过时长、画幅、帧率或音视频规格验证')
  }
  await run(process.env.FFMPEG_BIN || 'ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', path,
    '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { timeout: 300_000, maxBuffer: 1024 * 1024 })
  return media
}
