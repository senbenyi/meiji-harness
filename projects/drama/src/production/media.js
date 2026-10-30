import {spawn} from 'node:child_process'
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

export async function command(binary, args, {signal, limit = 256000} = {}) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe'], signal})
    let stdout = '', stderr = ''
    child.stdout.on('data', data => {stdout += data; if (stdout.length > limit) child.kill()})
    child.stderr.on('data', data => {stderr = (stderr + data).slice(-limit)})
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${binary}执行失败：${stderr.slice(-4000)}`)))
  })
}
export async function probeFile(path, {signal} = {}) {
  const result = JSON.parse(await command('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',path], {signal}))
  const duration = Number(result.format?.duration || result.streams?.find(s => Number(s.duration) > 0)?.duration || 0)
  return {duration, video: result.streams?.find(s => s.codec_type === 'video') || null, audio: result.streams?.find(s => s.codec_type === 'audio') || null}
}
export async function withTemporary(work) {
  const root = await mkdtemp(join(tmpdir(), 'drama-media-'))
  try {return await work(root)} finally {await rm(root, {recursive: true, force: true})}
}
export async function probeBytes(bytes, extension, options) {
  return withTemporary(async root => {const path = join(root, `input.${extension}`); await writeFile(path, bytes); return probeFile(path, options)})
}
export async function normalizeImage(bytes, {signal} = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 24*1024*1024) throw new TypeError('图片需为不超过24MiB的文件')
  return withTemporary(async root => {
    const input = join(root, 'input'), output = join(root, 'image.png'); await writeFile(input, bytes)
    const media = await probeFile(input, {signal})
    if (!media.video || media.video.width < 1 || media.video.height < 1 || media.video.width * media.video.height > 40000000 || !['png','mjpeg','webp'].includes(media.video.codec_name)) throw new TypeError('仅支持有效PNG/JPEG/WebP图片，最多4000万像素')
    await command('ffmpeg', ['-v','error','-i',input,'-frames:v','1','-y',output], {signal})
    return readFile(output)
  })
}
export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000)), h = Math.floor(ms/3600000), m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`
}
