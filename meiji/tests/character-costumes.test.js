import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCostumes, mergeCostumes, wardrobeFields } from '../shared/character-costumes.js'
import { createLibraryEntry, mergeLibraryGroup } from '../shared/library-rules.js'
import { migrateCostumes, migrateCharacterCostumes } from '../scripts/migrate-character-costumes.js'
import { setupModel } from './fixtures/model.js'
import { parseCharacters } from '../server/flow/steps/step-extract-characters.js'
import { characterExtractionContent } from '../shared/character-extraction.js'
const row = { id: '', name: '工作服', description: '蓝色工作服、黑鞋', context: '车间' }

test('服装稳定 ID、编辑、重复提取及非法数组校验', () => {
  const first = normalizeCostumes([row]); assert.ok(first[0].id)
  assert.deepEqual(normalizeCostumes([row], first), first)
  assert.deepEqual(mergeCostumes(first, [row]), first)
  const edited = normalizeCostumes([{ ...first[0], description: '深蓝工作服' }], first)
  assert.equal(edited[0].id, first[0].id)
  assert.throws(() => mergeCostumes(first, edited), /不得改写已有服装/)
  assert.throws(() => normalizeCostumes([first[0], first[0]]), /重复/)
  assert.throws(() => normalizeCostumes('衣服'), /数组/)
  assert.throws(() => normalizeCostumes([{ id: '', name: '服装' }]), /服装/)
})

test('已有角色提取新服装保留库外貌；审核投影只提交服装增量', () => {
  const project = { library: { characters: [], scenes: [], props: [] }, plot: { characters: { items: [] }, scenes: { items: [] } } }
  const target = createLibraryEntry(project, 'characters', { name: '小林', look: '固定外貌', costumes: [row] })
  const added = { ...row, name: '礼服', description: '黑色礼服', context: '典礼' }
  const group = parseCharacters(JSON.stringify({ items: [{ name: '小林', libraryId: target.entry.id, presence: 'visible', costumes: [added], look: '错误外貌' }] }), project)
  assert.equal(group.items[0].look, '固定外貌'); assert.equal(group.items[0].costumes.length, 2)
  const projected = characterExtractionContent(project, group).items[0]
  assert.equal(projected.costumes.length, 1); assert.equal(projected.look, undefined)
  const merged = mergeLibraryGroup(project, 'characters', group)
  assert.equal(merged.library.characters[0].variants[0].fields.costumes.length, 2)
  assert.equal(merged.plot.characters.items[0].costumes[0].id, target.variant.fields.costumes[0].id)
})

test('旧服装迁移保留原描述和图片、关联服装 ID 一致、幂等并实际备份读回', async t => {
  const e = await setupModel(t)
  const before = await e.store.read(e.id), old = before.episodes[0].plot.characters.items[0]
  delete old.costumes
  const target = createLibraryEntry(before, 'characters', old); delete target.variant.fields.costumes
  old.ref = { libraryId: target.entry.id, variantId: target.variant.id }
  await e.store.save(e.id, before)
  const savedBefore = (await e.store.read(e.id)).episodes[0].plot.characters.items[0]
  const result = await migrateCharacterCostumes(e.home)
  assert.equal(result.migrated, 1); assert.ok(result.backup)
  const next = await e.store.read(e.id), card = next.episodes[0].plot.characters.items[0]
  assert.equal(card.costumes.length, 1); assert.deepEqual(card.image, savedBefore.image); assert.equal(card.costume, savedBefore.costume)
  assert.equal(card.defaultCostumeId, card.costumes[0].id)
  assert.equal(card.defaultCostumeId, next.library.characters[0].variants[0].fields.defaultCostumeId)
  assert.deepEqual(card.costumes, next.library.characters[0].variants[0].fields.costumes)
  assert.deepEqual(migrateCostumes(next), next)
  assert.deepEqual(await migrateCharacterCostumes(e.home), { migrated: 0 })
})

test('只补充服装集合同步关联卡片，不清理已有分镜视频', async t => {
  const e = await setupModel(t), view = await e.read()
  const { scopeProjects } = await import('../server/data/episode-data.js')
  await scopeProjects(e.store, e.episodeId).save(e.id, mergeLibraryGroup(view, 'characters', view.plot.characters))
  // 建立关联本身可能清理旧引用，这里恢复本任务要保护的成片。
  await e.store.save(e.id, root => { root.episodes[0].shots = structuredClone(view.shots); return root })
  const before = await e.store.read(e.id)
  await e.store.save(e.id, root => { root.library.characters[0].variants[0].fields.costumes = normalizeCostumes([row]); return root })
  const after = await e.store.read(e.id)
  const { operationDeletes } = await import('../shared/operation-cascade.js')
  assert.deepEqual(operationDeletes(before, { action: 'entry-edit', libraryKind: 'characters', libraryId: before.library.characters[0].id, fields: { costumes: normalizeCostumes([row]) } }), [])
  assert.deepEqual(after.episodes[0].shots, before.episodes[0].shots)
  assert.equal(after.episodes[0].plot.characters.items[0].costumes.length, 1)
})


test('默认服装按原默认描述建立，重排与追加不改ID，删除后明确重选', () => {
 const costumes=normalizeCostumes([row,{...row,name:'礼服',description:'黑色礼服'}])
 const first=wardrobeFields({costumes,costume:'黑色礼服'})
 assert.equal(first.defaultCostumeId,costumes[1].id)
 assert.equal(wardrobeFields({costumes:[...costumes].reverse()},first).defaultCostumeId,first.defaultCostumeId)
 assert.equal(wardrobeFields({costumes:[costumes[0]]},first).defaultCostumeId,costumes[0].id)
 assert.throws(()=>wardrobeFields({costumes,defaultCostumeId:'missing'}),/默认服装不存在/)
})
