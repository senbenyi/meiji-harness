import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runtimeConfig, requiredConfig } from '../config.js'
import { summarizeMedia } from '../functions/common/diagnostics.js'
const run = promisify(execFile)
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

export function serverPath(value) {
  if (typeof value !== 'string' || !value.startsWith('ssh://')) return null
  const match = /^ssh:\/\/([A-Za-z0-9][A-Za-z0-9_.-]*)(\/[A-Za-z0-9_./-]+)$/.exec(value)
  if (!match || match[2].split('/').includes('..') || match[1] !== runtimeConfig().COMFYUI_SSH_HOST) throw new Error('服务器素材必须使用已配置 SSH 主机和绝对路径')
  return match[2]
}

export async function serverMedia(request, signal) {
  const config = runtimeConfig(), host = config.COMFYUI_SSH_HOST
  if (host && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(host)) throw new Error('无效 SSH 主机别名')
  const outputRoot = requiredConfig('MINIMAX_H3_COMFYUI_OUTPUT_ROOT')
  const body = { ...request, output_root: outputRoot,
    input_root: config.COMFYUI_INPUT_ROOT || join(dirname(outputRoot), 'input'),
    ffprobe: host ? 'ffprobe' : config.FFPROBE_BIN || 'ffprobe', ffmpeg: host ? 'ffmpeg' : config.FFMPEG_BIN || 'ffmpeg' }
  const script = await readFile(new URL('./server-media.py', import.meta.url), 'utf8')
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64')
  const python = host ? config.COMFYUI_SERVER_PYTHON || 'python3' : config.HARNESS_PYTHON || 'python3'
  const args = host ? ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, `${quote(python)} -c ${quote(script)} ${quote(encoded)}`] : ['-c', script, encoded]
  let stdout
  try { ({ stdout } = await run(host ? 'ssh' : python, args, { signal, timeout: 360_000, maxBuffer: 32 * 1024 * 1024 })) }
  catch (error) {
    signal?.throwIfAborted()
    throw new Error(`服务器素材检查失败：${String(error.stderr || error.code || '连接失败').slice(-1500)}`)
  }
  const result = JSON.parse(stdout)
  return { ...result, path: host ? `ssh://${host}${result.server_path}` : result.server_path, media_info: summarizeMedia(result.probe) }
}
