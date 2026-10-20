import { spawn } from 'node:child_process'

export function ffmpegAvailable(spawnImpl = spawn) {
  return new Promise(resolve => {
    let child
    try { child = spawnImpl('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { return resolve(false) }
    child.once('error', () => resolve(false))
    child.once('close', code => resolve(code === 0))
  })
}
