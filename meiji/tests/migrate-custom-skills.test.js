import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { addEpisode } from '../server/data/episodes.js'
import { readProjectFile, writeProjectFile } from '../server/data/project-files.js'
import { migrateCustomSkills } from '../scripts/migrate-custom-skills.js'
import { projectStore } from '../server/data/projects.js'

const asset = (id, type = 'action') => ({ id, name: `${id}.md`, guidanceType: type, content: `${id} 内容` })

test('per-episode supplements and guide selections move to the drama, labelled by source episode', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, current => addEpisode(current, { summary: '第二集', durationSeconds: 10 }))
  const project = await readProjectFile(e.home, e.id)
  const [second, first] = project.episodes
  first.customSkills = { shots: '保持远景', film: '成片慢节奏', storyboard: '同一要求' }
  first.guidanceAssets = { seconds: [asset('a'), asset('b', 'sound')], film: [asset('m', 'music')] }
  second.customSkills = { shots: '第二集镜头要求', storyboard: '同一要求', outline: '' }
  second.guidanceAssets = { seconds: [asset('b', 'sound'), asset('c', 'martial')] }
  await writeProjectFile(e.home, project)
  await assert.rejects(projectStore(e.home).read(e.id), { code: 'OLD_CUSTOM_SKILLS' })

  const result = await migrateCustomSkills(e.home)
  assert.equal(result.migrated, 1)
  const migrated = await projectStore(e.home).read(e.id)
  for (const episode of migrated.episodes) assert.equal('customSkills' in episode || 'guidanceAssets' in episode, false)
  const { additions, assets, guidance } = migrated.skills
  assert.equal(additions.shots.generate, '（来自第 1 集）\n保持远景\n\n（来自第 2 集）\n第二集镜头要求')
  assert.equal(additions['shot-revise'].generate, additions.shots.generate)
  assert.equal(additions.storyboard.generate, '（来自第 1、2 集）\n同一要求')
  assert.equal(additions.video.generate, '（来自第 1 集）\n成片慢节奏')
  assert.equal(additions.outline, undefined)
  assert.deepEqual(assets.seconds.map(item => item.id), ['a', 'b', 'c'])
  assert.deepEqual(assets.film.map(item => item.id), ['m'])
  assert.deepEqual(guidance.enabled, ['action', 'dialogue', 'expression', 'sound'])
  const backups = await readdir(join(e.home, 'backups'))
  assert.equal(backups.length, 1)
  assert.deepEqual((await readdir(join(e.home, 'backups', backups[0], e.id))).sort(), [e.id + '.json', 'episodes'].sort())
  // 可重复执行：已迁移的项目跳过
  assert.deepEqual(await migrateCustomSkills(e.home), { migrated: 0 })
})
