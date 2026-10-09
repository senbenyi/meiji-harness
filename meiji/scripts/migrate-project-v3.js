// 离线迁移已分集存储的 v2 项目索引；不改任何剧集、素材或历史文件。
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { projectIds, indexFile, readProjectFile } from '../server/data/project-files.js'
import { assertDrama } from '../server/models/data/drama-model.js'

export async function migrateProjectV3(home) {
  const pending = []
  for (const id of await projectIds(home)) {
    const file = indexFile(home, id), raw = await readFile(file, 'utf8'), source = JSON.parse(raw)
    if (source.schemaVersion === 3) continue
    if (source.schemaVersion !== 2 || source.layout !== 2) throw new Error('此迁移仅接受 schemaVersion=2、layout=2 的项目')
    const next = { premise: '', scriptKind: source.script ? 'imported' : 'assembled', scriptSections: { sections: [], future: '' }, scriptRevision: 0,
      scriptSource: null, scriptProposals: [], scriptPendingDeletes: [], library: { characters: [], scenes: [], props: [] }, ...source, schemaVersion: 3 }
    const before = await readProjectFile(home, id)
    assertDrama(structuredClone({ ...before, ...next, episodes: before.episodes }))
    pending.push({ id, file, raw, next, before })
  }
  if (!pending.length) return { migrated: 0 }
  const backup = join(home, 'backups', 'project-v3-' + new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(backup, { recursive: true })
  for (const item of pending) await copyFile(item.file, join(backup, item.id + '.json'))
  try {
    for (const item of pending) {
      await writeFile(item.file + '.migrating', JSON.stringify(item.next, null, 2) + '\n', { mode: 0o600 })
      await rename(item.file + '.migrating', item.file)
      const readback = await readProjectFile(home, item.id)
      if (!isDeepStrictEqual(readback.episodes, item.before.episodes)) throw new Error('剧集内容发生变化')
      for (const [key, value] of Object.entries(item.before)) {
        if (key !== 'schemaVersion' && !isDeepStrictEqual(readback[key], value)) throw new Error('原项目字段发生变化：' + key)
      }
      assertDrama(readback)
    }
  } catch (error) {
    for (const item of pending) await copyFile(join(backup, item.id + '.json'), item.file)
    throw error
  }
  return { migrated: pending.length, backup }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('先停止服务，再运行：node meiji/scripts/migrate-project-v3.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateProjectV3(resolve(process.argv[2])), null, 2))
}
