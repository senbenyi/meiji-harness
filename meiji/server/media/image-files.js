import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const stillExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export async function readStill(directory, itemId) {
  for (const [mime, ext] of Object.entries(stillExt)) {
    try {
      return { bytes: await readFile(join(directory, `${itemId}.${ext}`)), mime }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw Object.assign(new Error('图片不存在'), { code: 'ENOENT' })
}

export async function replaceStill(directory, itemId, ext, bytes) {
  await mkdir(directory, { recursive: true })
  await Promise.all(Object.values(stillExt).filter(name => name !== ext).map(name => rm(join(directory, `${itemId}.${name}`), { force: true })))
  await writeFile(join(directory, `${itemId}.${ext}`), bytes, { mode: 0o600 })
}
