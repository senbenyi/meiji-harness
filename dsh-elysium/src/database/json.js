// 职责：以临时文件加原子替换读写本地 JSON 状态。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

export const readJson = path => readFile(path, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null
  throw error
})
