/**
 * 媒体探针：只采集实测指标，不做任何判定。判定在 domain/media-gate.js。
 *
 * 指标口径必须与 llm-ai-model/contracts/media-gate-contract.json 的 metrics 表一致。
 */
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { ElysiumError } from '../persistence/store.js'

// 契约 conventions.colorRange：signalstats 为 limited/TV range，纯黑 Y=16 而非 0。
const DARK_YAVG = 20
const FLAT_ENTROPY = 0.05
const STATIC_YDIF = 0.5
const LOUDNESS_FLOOR = -70
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { if (stdout.length < MAX_OUTPUT_BYTES) stdout += String(chunk) })
    child.stderr.on('data', chunk => { if (stderr.length < MAX_OUTPUT_BYTES) stderr += String(chunk) })
    child.once('error', error => reject(new ElysiumError('FFPROBE_MISSING', error.message, 500)))
    child.once('close', code => resolve({ code, stdout, stderr }))
  })
}

function parseFps(stream) {
  const [numerator, denominator] = String(stream?.avg_frame_rate || '0/1').split('/')
  const divisor = Number(denominator || 1)
  const value = divisor ? Number(numerator) / divisor : 0
  return Number.isFinite(value) ? value : 0
}

/** 逐帧 signalstats + entropy。用 metadata=print 而非 movie= 滤镜，避开路径转义问题。 */
async function frameMetrics(ffmpeg, file) {
  const { stdout } = await capture(ffmpeg, [
    '-hide_banner', '-nostats', '-loglevel', 'error', '-i', file,
    '-vf', 'signalstats,entropy,metadata=mode=print:file=-', '-f', 'null', '-',
  ])
  const frames = []
  let current = null
  for (const line of stdout.split('\n')) {
    if (line.startsWith('frame:')) {
      current = {}
      frames.push(current)
    } else if (current) {
      const index = line.indexOf('=')
      if (index <= 0) continue
      const value = Number(line.slice(index + 1))
      if (Number.isFinite(value)) current[line.slice(0, index).trim()] = value
    }
  }
  return frames
}

async function loudnessOf(ffmpeg, file) {
  const { stderr } = await capture(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'])
  const match = stderr.match(/I:\s+(-?[\d.]+|-inf)\s+LUFS/)
  if (!match) return null
  return match[1] === '-inf' ? LOUDNESS_FLOOR : Number(match[1])
}

async function silenceRatioOf(ffmpeg, file, duration) {
  if (!(duration > 0)) return null
  const { stderr } = await capture(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-50dB:d=0.05', '-f', 'null', '-'])
  let total = 0
  for (const match of stderr.matchAll(/silence_duration:\s+([\d.]+)/g)) total += Number(match[1])
  // 契约 conventions.ratioClamp：detect 类滤镜求和可能略大于 1，必须 clamp。
  return Math.min(1, total / duration)
}

function ratio(values, predicate) {
  return values.length ? values.filter(predicate).length / values.length : null
}

/**
 * 采集契约 metrics 表中的实测值。缺失的指标留空，对应规则会被跳过。
 * @param {{ffmpeg?: string, ffprobe?: string}} config
 * @param {string} file 绝对路径
 * @param {string[]} kinds
 */
export async function probeMedia(config, file, kinds) {
  const ffmpeg = String(config?.ffmpeg || 'ffmpeg')
  const ffprobe = String(config?.ffprobe || 'ffprobe')
  const info = await stat(file).catch(() => null)
  const metrics = { bytes: info?.isFile() ? info.size : 0 }
  if (metrics.bytes === 0) return { ...metrics, decodable: false, frameCount: 0 }

  const probe = await capture(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])
  let container = null
  if (probe.code === 0) {
    try { container = JSON.parse(probe.stdout) } catch { container = null }
  }
  metrics.decodable = Boolean(container?.streams?.length)
  if (!metrics.decodable) return { ...metrics, frameCount: 0 }

  const video = container.streams.find(item => item.codec_type === 'video')
  const audio = container.streams.find(item => item.codec_type === 'audio')
  if (video) {
    metrics.width = video.width || 0
    metrics.height = video.height || 0
    metrics.fps = parseFps(video)
  }
  metrics.durationSec = Number(container.format?.duration || 0)

  const frames = await frameMetrics(ffmpeg, file)
  metrics.frameCount = frames.length
  if (frames.length) {
    const yavg = frames.filter(f => 'lavfi.signalstats.YAVG' in f).map(f => f['lavfi.signalstats.YAVG'])
    const entropy = frames.filter(f => 'lavfi.entropy.normalized_entropy.normal.Y' in f).map(f => f['lavfi.entropy.normalized_entropy.normal.Y'])
    const ydif = frames.filter(f => 'lavfi.signalstats.YDIF' in f).map(f => f['lavfi.signalstats.YDIF']).slice(1)
    const ranges = frames.filter(f => 'lavfi.signalstats.YMAX' in f && 'lavfi.signalstats.YMIN' in f)
      .map(f => f['lavfi.signalstats.YMAX'] - f['lavfi.signalstats.YMIN'])
    const dark = ratio(yavg, value => value <= DARK_YAVG)
    const flat = ratio(entropy, value => value < FLAT_ENTROPY)
    const staticRatio = ratio(ydif, value => value < STATIC_YDIF)
    if (dark !== null) metrics.darkFrameRatio = dark
    if (flat !== null) metrics.flatFrameRatio = flat
    if (staticRatio !== null) metrics.staticFrameRatio = staticRatio
    if (ranges.length) metrics.minDynamicRange = Math.min(...ranges)
  }

  if (kinds.includes('audio')) {
    metrics.hasAudioStream = Boolean(audio)
    if (audio) {
      metrics.audioCodec = audio.codec_name || null
      metrics.sampleRate = Number(audio.sample_rate || 0)
      metrics.integratedLufs = await loudnessOf(ffmpeg, file)
      metrics.silenceRatio = await silenceRatioOf(ffmpeg, file, metrics.durationSec)
    }
  }
  return metrics
}
