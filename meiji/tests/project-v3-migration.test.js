import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { indexFile, episodesDir } from '../server/data/project-files.js'
import { migrateProjectV3 } from '../scripts/migrate-project-v3.js'

test('v2 分集项目迁移只补索引字段，剧集文件及原数据保持且可重复执行', async t => {
  const e = await setupModel(t), file = indexFile(e.home, e.id)
  const source = JSON.parse(await readFile(file, 'utf8'))
  source.schemaVersion = 2
  for (const key of ['premise', 'scriptKind', 'scriptSections', 'scriptRevision', 'scriptSource', 'scriptProposals', 'scriptPendingDeletes', 'library']) delete source[key]
  const raw = JSON.stringify(source)
  await writeFile(file, raw)
  const dir = episodesDir(e.home, e.id), files = await readdir(dir), contents = await Promise.all(files.map(name => readFile(join(dir, name), 'utf8')))
  const result = await migrateProjectV3(e.home)
  assert.equal(result.migrated, 1)
  assert.equal(await readFile(join(result.backup, e.id + '.json'), 'utf8'), raw)
  const current = JSON.parse(await readFile(file, 'utf8'))
  for (const [key, value] of Object.entries(source)) if (key !== 'schemaVersion') assert.deepEqual(current[key], value)
  assert.deepEqual(await readdir(dir), files)
  assert.deepEqual(await Promise.all(files.map(name => readFile(join(dir, name), 'utf8'))), contents)
  assert.equal((await e.store.read(e.id)).schemaVersion, 3)
  assert.deepEqual(await migrateProjectV3(e.home), { migrated: 0 })
})
