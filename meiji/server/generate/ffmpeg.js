// 启动检查：尾帧提取、全片拼接与图片压缩依赖本机 ffmpeg。
import { spawn } from 'node:child_process'

export function ffmpegAvailable(spawnImpl = spawn) {
  return new Promise(resolve => {
    let child
    try { child = spawnImpl('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { return resolve(false) }
    child.once('error', () => resolve(false))
    child.once('close', code => resolve(code === 0))
  })
}
