import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

export async function saveLastFrame(videoPath, framePath, spawnImpl = spawn) {
  await new Promise((resolve, reject) => {
    const child = spawnImpl('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-map', '0:v:0',
      '-update', '1',
      framePath,
    ])
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', error => reject(Object.assign(new Error(error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '无法抽出尾帧'), { status: error.code === 'ENOENT' ? 503 : 502 })))
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(Object.assign(new Error(stderr.trim() || '无法抽出上一镜的尾帧'), { status: 502 }))
    })
  })
  const bytes = await readFile(framePath)
  if (!bytes.length) throw Object.assign(new Error('无法抽出上一镜的尾帧'), { status: 502 })
  return bytes
}
