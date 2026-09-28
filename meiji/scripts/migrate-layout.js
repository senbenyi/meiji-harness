// 存储布局迁移：单文件项目 → 项目索引 + 每集一个文件（layout 2）。内容不变，只改存储方式。
// 用法（先停止 Harness）：node meiji/scripts/migrate-layout.js <DSH_HOME>
// 已是 layout 2 的项目跳过，可重复执行。迁移前把待迁移的项目文件完整备份到 <DSH_HOME>/backups/layout-v2-<时间>/，
// 每个项目写入后立即按新布局读回并与原文逐字段比对，不一致则还原该项目并中止。
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LAYOUT, indexFile, projectIds, readProjectFile, writeProjectFile } from '../server/data/project-files.js'
import { schemaVersion } from '../shared/drama-model.js'

const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item)

export async function migrateLayout(home) {
  const pending = []
  for (const id of await projectIds(home)) {
    const source = JSON.parse(await readFile(indexFile(home, id), 'utf8'))
    if (source.layout === LAYOUT) continue
    if (source.id !== id) throw new Error(`${id}.json 的项目 ID 不一致，未迁移任何项目`)
    if (source.schemaVersion !== schemaVersion) throw new Error(`${id}.json 仍是旧数据结构，请先执行 node meiji/scripts/migrate-model.js <DSH_HOME>`)
    pending.push({ id, source })
  }
  if (!pending.length) return { migrated: 0 }
  const backup = join(home, 'backups', `layout-v2-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(backup, { recursive: true })
  for (const { id } of pending) await copyFile(indexFile(home, id), join(backup, id + '.json'))
  const migrated = []
  for (const { id, source } of pending) {
    try {
      await writeProjectFile(home, source, null)
      if (canonical(await readProjectFile(home, id)) !== canonical(source)) throw new Error('读回内容与原文不一致')
    } catch (error) {
      await writeFile(indexFile(home, id), JSON.stringify(source, null, 2) + '\n', { mode: 0o600 })
      throw new Error(`${id} 迁移失败，已还原该项目（备份：${backup}）：${error.message}`)
    }
    migrated.push({ id, episodes: source.episodes?.length || 0 })
  }
  return { migrated: migrated.length, backup, projects: migrated }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-layout.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateLayout(resolve(process.argv[2])), null, 2))
}
