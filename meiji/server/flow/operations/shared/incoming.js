// 共享函数：任务与操作共用
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function openIncoming(home, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw Object.assign(new Error('上传的文件已失效'), { status: 400 })
  const directory = join(home, 'storages', 'meiji', 'incoming', id)
  const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8'))
  return { directory, file: join(directory, 'file'), mime: meta.mime, name: meta.name }
}

export async function saveIncoming(home, { name, category, mime, bytes }) {
  if (!bytes?.length) throw Object.assign(new Error('文件是空的'), { status: 400 })
  const id = randomUUID()
  const directory = join(home, 'storages', 'meiji', 'incoming', id)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'file'), bytes, { mode: 0o600 })
  await writeFile(join(directory, 'meta.json'), JSON.stringify({ name, category: category || '', mime }) + '\n', { mode: 0o600 })
  return id
}
