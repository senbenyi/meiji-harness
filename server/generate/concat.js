import { spawn } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'

export function concatList(inputs) {
  return inputs.map(input => `file '${String(input).replaceAll("'", "'\\''")}'\n`).join('')
}

export async function concatFilms({ inputs, output, spawnImpl = spawn }) {
  if (!inputs.length) throw Object.assign(new Error('没有可拼接的成片'), { status: 409 })
  const listPath = `${output}.txt`
  await writeFile(listPath, concatList(inputs))
  try {
    await new Promise((resolve, reject) => {
      const child = spawnImpl('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        output,
      ])
      let stderr = ''
      child.stderr?.on('data', chunk => { stderr += chunk })
      child.once('error', error => reject(Object.assign(new Error(error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '无法启动拼接'), { status: error.code === 'ENOENT' ? 503 : 502 })))
      child.once('close', code => {
        if (code === 0) resolve()
        else reject(Object.assign(new Error(stderr.trim() || '全片拼接失败'), { status: 502 }))
      })
    })
  } finally {
    await rm(listPath, { force: true })
  }
}
