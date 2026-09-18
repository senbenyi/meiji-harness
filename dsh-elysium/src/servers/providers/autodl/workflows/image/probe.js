// 职责：读取 AutoDL ComfyUI HTTP 图片的像素尺寸，供三视图拼接校验。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mediaReference } from '../../../../../comfyui/media-reference.js'

const run = promisify(execFile)

export async function probeImage(path) {
  const url = mediaReference(path, ['.png', '.jpg', '.jpeg', '.webp']).url
  const { stdout } = await run('ffprobe', [
    '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', url,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 })
  const stream = JSON.parse(stdout).streams?.[0]
  const width = Number(stream?.width), height = Number(stream?.height)
  if (!(width > 0) || !(height > 0)) throw new Error('无法读取 HTTP 图片尺寸')
  return { width, height }
}
