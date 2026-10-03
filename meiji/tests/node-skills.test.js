import { reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { materialize } from '../shared/episode-rules.js'
import { nodeSkills, nodeSkillsPatch } from '../shared/node-skills.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { buildEpisodePrompts } from '../server/prompts/episode-summary-prompts.js'
import { executionContext } from '../server/runtime/task-context.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { migrateNodeSkills, migrateProjectNodeSkills } from '../scripts/migrate-node-skills.js'
import { assertDrama } from '../shared/drama-model.js'

test('补充 skill CRUD 只影响当前集节点，非法节点/内容/ID 拒绝', async t => {
  const e = await setupModel(t), other = episodeFixture()
  await e.store.save(e.id, current => ({ episodes: [...current.episodes, other] }))
  let root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'outline', content: '局部要求' }))
  const item = nodeSkills(root, e.episodeId, 'outline')[0]
  assert.equal(nodeSkills(root, other.id, 'outline').length, 0)
  assert.equal(nodeSkills(root, e.episodeId, 'characters').length, 0)
  root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'outline', id: item.id, content: '最新要求' }))
  assert.equal(nodeSkills(root, e.episodeId, 'outline')[0].content, '最新要求')
  for (const fields of [{ nodeKey: 'outline', content: '' }, { nodeKey: 'film:missing', content: 'x' }, { nodeKey: 'outline', id: 'missing', content: 'x' }, { nodeKey: 'outline', remove: true }]) assert.throws(() => nodeSkillsPatch(root, { episodeId: e.episodeId, ...fields }))
  root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'outline', id: item.id, remove: true }))
  assert.equal(nodeSkills(root, e.episodeId, 'outline').length, 0)
  root.episodes[0].supplementalSkills = { outline: [{ id: 'bad', content: null }] }
  assert.throws(() => assertDrama(root), /格式错误/)
})

test('生成、修订与审核共用任务固定补充，人物/场景及其他集不继承大纲要求', async t => {
  const e = await setupModel(t), root = await e.store.read(e.id)
  root.episodes[0].supplementalSkills = { outline: [{ id: 'a', content: 'OUTLINE_ONLY' }], summary: [{ id: 'b', content: 'SUMMARY_ONLY' }] }
  const view = materialize(root, e.episodeId), set = builtinSkillSet(root.skills)
  set.nodeSupplements = structuredClone({ [e.episodeId]: view.supplementalSkills })
  view.supplementalSkills.outline[0].content = 'LATER_EDIT'
  executionContext.run({ skillSet: set, skills: new Map() }, () => {
    const outline = buildStoryPrompts(view)
    for (const prompt of [outline.generation, outline.revision('BASE', reviewFail('REASON')), outline.review('RESULT')]) { assert.match(prompt.system, /OUTLINE_ONLY/); assert.doesNotMatch(prompt.system, /LATER_EDIT|SUMMARY_ONLY/) }
    for (const kind of ['characters', 'scenes']) assert.doesNotMatch(buildStoryPrompts(view, kind).generation.system, /OUTLINE_ONLY/)
    assert.match(buildEpisodePrompts(root, e.episodeId).generation.system, /SUMMARY_ONLY/)
    assert.doesNotMatch(buildEpisodePrompts(root).generation.system, /SUMMARY_ONLY/)
  })
})

test('首次大纲展开当前摘要，明确重新生成仍不沿用旧摘要', async t => {
  const e = await setupModel(t), view = await e.read()
  view.plot.outline.content = null
  assert.match(buildStoryPrompts(view).generation.user, /【本集摘要】\n/)
  assert.match(buildStoryPrompts(view).generation.user, /旅人进入庭院/)
})

test('迁移完整备份和读回，旧补充保留到已有节点；重复执行不新增', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, { skills: { additions: { outline: { common: '旧全剧剧情要求' }, episode: { generate: '旧摘要要求' } } } })
  const before = await e.store.read(e.id), next = migrateProjectNodeSkills(before)
  assert.match(next.episodes[0].supplementalSkills.characters[0].content, /旧全剧剧情要求/)
  assert.equal(before.episodes[0].supplementalSkills.characters, undefined)
  assert.deepEqual(migrateProjectNodeSkills(next), next)
  const result = await migrateNodeSkills(e.home)
  assert.equal(result.migrated, 1)
  assert.ok(result.backup)
  assert.equal((await migrateNodeSkills(e.home)).migrated, 0)
  assert.match((await e.store.read(e.id)).episodes[0].supplementalSkills.summary[0].content, /旧摘要要求/)
})

test('整段替换原子合并旧条目，空保存清空且其他节点不变', async t => {
 const e = await setupModel(t)
 let root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'outline', content: '甲' }))
 root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'outline', content: '乙' }))
 root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'characters', content: '其他节点' }))
 root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'outline', replace: true, content: '甲\n\n乙' }))
 assert.equal(nodeSkills(root, e.episodeId, 'outline').length, 1)
 assert.equal(nodeSkills(root, e.episodeId, 'outline')[0].content, '甲\n\n乙')
 assert.throws(() => nodeSkillsPatch(root, { episodeId: e.episodeId, nodeKey: 'outline', replace: true, content: '字'.repeat(10001) }))
 root = await e.store.save(e.id, current => nodeSkillsPatch(current, { episodeId: e.episodeId, nodeKey: 'outline', replace: true, content: '' }))
 assert.equal(nodeSkills(root, e.episodeId, 'outline').length, 0)
 assert.equal(nodeSkills(root, e.episodeId, 'characters')[0].content, '其他节点')
})
