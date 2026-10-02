/**
 * 视频拼接（delivery 层的确定性操作，非模型能力）。
 *
 * 两条后端，按环境自动选择：
 *  1. ffmpeg（优先）—— concat demuxer + stream copy，零重编码、零显存、秒级；
 *     参数不一致导致 copy 失败时自动降级为重编码。
 *  2. ComfyUI（退化）—— 纯节点链路，不需要任何本地二进制：
 *       LoadVideo → GetVideoComponents → ImageBatch / AudioConcat 左折叠 →
 *       CreateVideo(images, fps, audio) → SaveVideo(mp4/h264)
 *     代价是整段素材要作为 IMAGE 张量进内存（N×帧数×W×H×3×4 字节）。
 *
 * 之所以不做成 workflow manifest：manifest 的 graph 是静态模板 + 定点注入，
 * 而拼接图的节点数与连线拓扑随片段数变化（变长左折叠），超出注入原语的表达能力。
 * 为一个确定性后处理扩展契约层不划算。
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { probeMp4 } from './upscale.js'

/**
 * 构造 ComfyUI 拼接图（纯函数，可测）。
 * @param {string[]} inputNames ComfyUI input 目录里的文件名（需先上传）
 * @param {string} filenamePrefix SaveVideo 的 filename_prefix
 */
export function buildConcatGraph(inputNames, filenamePrefix) {
  if (!Array.isArray(inputNames) || inputNames.length < 2) {
    throw new Error('concat-invalid: 至少需要 2 段片段')
  }
  const graph = {}
  const comps = []
  inputNames.forEach((file, i) => {
    graph[`load${i}`] = { class_type: 'LoadVideo', inputs: { file } }
    graph[`comp${i}`] = { class_type: 'GetVideoComponents', inputs: { video: [`load${i}`, 0] } }
    comps.push(`comp${i}`)
  })

  // 左折叠：images 走 ImageBatch，audio 走 AudioConcat；fps 取首段
  let images = [comps[0], 0]
  let audio = [comps[0], 1]
  for (let i = 1; i < comps.length; i++) {
    graph[`batch${i}`] = { class_type: 'ImageBatch', inputs: { image1: images, image2: [comps[i], 0] } }
    graph[`acat${i}`] = { class_type: 'AudioConcat', inputs: { audio1: audio, audio2: [comps[i], 1], direction: 'after' } }
    images = [`batch${i}`, 0]
    audio = [`acat${i}`, 0]
  }

  graph.create = { class_type: 'CreateVideo', inputs: { images, fps: [comps[0], 2], audio } }
  graph.save = {
    class_type: 'SaveVideo',
    inputs: { video: ['create', 0], filename_prefix: filenamePrefix, format: 'mp4', codec: 'h264' },
  }
  return graph
}

/** 跑一条命令，返回 {code, stderr}。参数走数组，不经 shell。 */
function run(bin, args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve) => {
    let stderr = ''
    let child
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch {
      resolve({ code: -1, stderr: 'spawn failed' })
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ code: -1, stderr: (stderr + '\nprocess timeout').trim() })
    }, timeoutMs)
    child.stderr?.on('data', (c) => { stderr = (stderr + String(c)).slice(-64 * 1024) })
    child.on('error', () => done({ code: -1, stderr: stderr || 'spawn error' }))
    child.on('close', (code) => done({ code, stderr }))
  })
}

let _ffmpegProbe
/** 探测本机 ffmpeg，返回可执行名或 null。结果缓存（进程内）。 */
export async function detectFfmpeg() {
  if (_ffmpegProbe !== undefined) return _ffmpegProbe
  const { code } = await run('ffmpeg', ['-version'])
  _ffmpegProbe = code === 0 ? 'ffmpeg' : null
  return _ffmpegProbe
}

/** concat demuxer 的清单行：单引号包裹，内部单引号按 ffmpeg 规则转义。 */
function concatListLine(absPath) {
  return "file '" + absPath.replace(/'/g, "'\\''") + "'"
}

/**
 * 用 ffmpeg 拼接。先试 stream copy；copy 失败（各段编码参数不一致）再重编码。
 * @returns {Promise<{reencoded: boolean}>}
 */
function atempoChain(factor) {
  const filters = []
  let value = factor
  while (value < 0.5) { filters.push('atempo=0.5'); value /= 0.5 }
  while (value > 2) { filters.push('atempo=2'); value /= 2 }
  filters.push(`atempo=${value.toFixed(8)}`)
  return filters.join(',')
}

function assertProbe(probe, targetDuration = 0, tolerance = 0.15) {
  if (!(probe.w > 0) || !(probe.h > 0) || !(probe.frames > 0) || !(probe.duration > 0)) {
    throw new Error('concat-validation-failed: 输出缺少可解码视频流、尺寸、帧数或时长')
  }
  if (targetDuration > 0 && Math.abs(probe.duration - targetDuration) > tolerance) {
    throw new Error(`concat-duration-mismatch: 目标 ${targetDuration}s，实际 ${probe.duration.toFixed(3)}s`)
  }
}

/**
 * 拼接并可选 conform 到目标时长。正式路径只在完整验收后原子替换。
 * @param {{targetDuration?:number,strategy?:'preserve'|'strict'|'retime',tolerance?:number,timeoutMs?:number}} options
 * @returns {Promise<{reencoded:boolean,retimed:boolean,probe:object}>}
 */
export async function ffmpegConcat(absPaths, outAbsPath, options = {}) {
  const bin = await detectFfmpeg()
  if (!bin) throw new Error('concat-no-ffmpeg: 本机无 ffmpeg')

  const targetDuration = Number(options.targetDuration || 0)
  const strategy = options.strategy || (targetDuration > 0 ? 'strict' : 'preserve')
  if (!['preserve', 'strict', 'retime'].includes(strategy)) throw new Error(`concat-invalid-strategy: ${strategy}`)
  if (strategy !== 'preserve' && !(targetDuration > 0)) throw new Error('concat-target-duration-required')

  const dir = await mkdtemp(join(tmpdir(), 'dsh-svs-concat-'))
  const listFile = join(dir, 'list.txt')
  const joined = join(dir, 'joined.mp4')
  const staged = join(dirname(outAbsPath), `.${Date.now()}-${Math.random().toString(16).slice(2)}.part.mp4`)
  try {
    await writeFile(listFile, absPaths.map((path) => concatListLine(resolve(path))).join('\n') + '\n', 'utf8')
    const base = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile]

    const copy = await run(bin, [...base, '-c', 'copy', joined], options.timeoutMs)
    let reencoded = false

    if (copy.code !== 0) {
      const enc = await run(bin, [
        ...base,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        joined,
      ], options.timeoutMs)
      if (enc.code !== 0) {
        throw new Error('concat-ffmpeg-failed: ' + (enc.stderr.split('\n').slice(-5).join(' ').trim() || copy.code))
      }
      reencoded = true
    }

    const inputProbe = probeMp4(joined)
    assertProbe(inputProbe)
    let retimed = false
    if (targetDuration > 0 && Math.abs(inputProbe.duration - targetDuration) > Number(options.tolerance || 0.15)) {
      if (strategy === 'strict') {
        throw new Error(`concat-duration-mismatch: 目标 ${targetDuration}s，拼接结果 ${inputProbe.duration.toFixed(3)}s；请显式选择 strategy=retime`)
      }
      if (strategy === 'retime') {
        const videoScale = targetDuration / inputProbe.duration
        const args = ['-y', '-i', joined, '-map', '0:v:0']
        if (inputProbe.hasAudio) args.push('-map', '0:a:0', '-filter:a', atempoChain(inputProbe.duration / targetDuration))
        args.push(
          '-filter:v', `setpts=${videoScale.toFixed(10)}*PTS`,
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
          ...(inputProbe.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
          '-t', targetDuration.toFixed(6), staged,
        )
        const conformed = await run(bin, args, options.timeoutMs)
        if (conformed.code !== 0) throw new Error('concat-retime-failed: ' + conformed.stderr.split('\n').slice(-5).join(' ').trim())
        reencoded = true
        retimed = true
      }
    } else {
      await rename(joined, staged)
    }

    if (!(await stat(staged)).size) throw new Error('concat-validation-failed: 输出文件为空')
    const outputProbe = probeMp4(staged)
    assertProbe(outputProbe, targetDuration, Number(options.tolerance || 0.15))
    await rename(staged, outAbsPath)
    return { reencoded, retimed, probe: outputProbe }
  } finally {
    await unlink(staged).catch(() => {})
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
