import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const stillByteLimit = 3 * 1024 * 1024

function runFfmpeg(args, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', error => reject(Object.assign(new Error(error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '图片无法压到 3MB 以内'), { status: error.code === 'ENOENT' ? 503 : 502 })))
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(Object.assign(new Error(stderr.trim() || '图片无法压到 3MB 以内'), { status: 502 }))
    })
  })
}

export async function limitStillBytes(bytes, spawnImpl = spawn) {
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 502 })
  if (bytes.length < stillByteLimit) return { ext: 'png', bytes }
  const directory = await mkdtemp(join(tmpdir(), 'meiji-still-'))
  const input = join(directory, 'in.bin')
  const output = join(directory, 'out.jpg')
  try {
    await writeFile(input, bytes)
    for (const quality of [8, 12, 16, 20, 28]) {
      await runFfmpeg(['-i', input, '-q:v', String(quality), output], spawnImpl)
      const next = await readFile(output)
      if (next.length && next.length < stillByteLimit) return { ext: 'jpg', bytes: next }
    }
    throw Object.assign(new Error('图片无法压到 3MB 以内'), { status: 502 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
