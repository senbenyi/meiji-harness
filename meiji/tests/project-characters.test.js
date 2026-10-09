import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { storyPackageFixture } from './fixtures/story-package.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import { useWorkspaces } from './fixtures/host.js'
import { linkStore } from '../server/data/workspace-links.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { createLibraryEntry } from '../shared/library-rules.js'
import { planRun } from '../shared/run-planner.js'
import { projectCharacterPrompts } from '../server/prompts/project-character-prompts.js'

const session = 'session-11111111-1111-4111-8111-111111111111'
const outfit = (name = '雨衣') => ({ id: '', name, description: `${name}、黑色长裤` })
async function setup(t, request) {
  const e = await setupModel(t); useWorkspaces(t)
  await e.store.save(e.id, root => ({ ...root, mode: 'script', script: '完整剧本：第一场旅人穿雨衣。最后一场旅人换上礼服。路人围观。', scriptRevision: 3, episodes: [] }))
  await linkStore(e.home).selectProject(session, e.id, e.store)
  const service = createRunService({ home: e.home, deps: { request, fetchImpl: async (url, options) => options.method === 'GET' ? new Response(Buffer.from('character-image')) : Response.json({ data: [{ url: `${url.origin}/v1/media/image_1` }] }) } }); t.after(() => service.dispose())
  return { ...e, service, start: async () => {
    const { run } = await service.plan({ projectId: e.id, goal: { to: 'project-characters', mode: 'regenerate' } }, session)
    await service.confirm(e.id, run.id, session)
    await service.drain()
    return service.get(e.id, run.id, session)
  } }
}

test('整部剧本无需剧集，生成并审核后增量入库，重复提取保持服装 ID 与固定资料', async t => {
  let generation = 0
  const e = await setup(t, async message => {
    assert.match(message.user, /完整剧本/); assert.match(message.user, /最后一场/)
    if (message.skill === 'review') return reviewPass
    generation++
    if (generation === 1) return JSON.stringify({ items: [{ ...storyPackageFixture().characters.items[0], costumes: [outfit(), outfit('礼服')] }] })
    return JSON.stringify({ items: [{ name: '旅人', presence: 'visible', libraryId: 'R01', costumes: [outfit(), outfit('礼服'), outfit('外套')] }] })
  })
  let done = await e.start()
  assert.equal(done.status, 'completed', JSON.stringify(done.failure || done.pause))
  assert.ok(done.steps.some(step => step.kind === 'image'))
  assert.ok(!done.steps.some(step => step.kind === 'wait_confirm'))
  const firstRoot = await e.store.read(e.id), first = firstRoot.library.characters[0]
  assert.equal(first.variants[0].fields.costumes.length, 2)
  assert.ok(first.variants[0].image.content.assetId)
  assert.equal(Object.keys(first.variants[0].image.content.costumes).length, 2)
  assert.deepEqual(firstRoot.pendingImages || {}, {})
  done = await e.start(); assert.equal(done.status, 'completed', JSON.stringify(done.failure || done.pause))
  const root = await e.store.read(e.id), fields = root.library.characters[0].variants[0].fields
  assert.equal(root.episodes.length, 0); assert.equal(root.library.characters.length, 1)
  assert.deepEqual(fields.costumes.slice(0, 2), first.variants[0].fields.costumes)
  assert.equal(fields.costumes.length, 3); assert.equal(fields.look, first.variants[0].fields.look)
  assert.equal(root.projectCharacters.check.passed, true)
  assert.ok(root.projectCharacters.revision > firstRoot.projectCharacters.revision)
  assert.ok(root.projectCharacters.source?.artifactId)
})

test('审核失败不发布角色，自动修订沿用全剧来源，空角色集合可以通过', async t => {
  let reviews = 0
  const e = await setup(t, async message => {
    if (message.skill === 'review') { reviews++; return reviews === 1 ? reviewFail('背景群演不应建卡') : reviewPass }
    return reviews ? '{"items":[]}' : JSON.stringify({ items: [{ ...storyPackageFixture().characters.items[0], costumes: [] }] })
  })
  const done = await e.start()
  assert.equal(done.status, 'completed', JSON.stringify(done.failure || done.pause))
  assert.ok(done.steps.some(step => step.kind === 'revise'))
  const root = await e.store.read(e.id); assert.equal(root.library.characters.length, 0); assert.equal(root.projectCharacters.check.passed, true)
})

test('模型接口失败保留已有角色库', async t => {
  const e = await setup(t, async () => { throw new Error('模拟网络失败') })
  await e.store.save(e.id, root => { createLibraryEntry(root, 'characters', { name: '已有角色', costumes: [outfit()] }); return root })
  const before = (await e.store.read(e.id)).library
  const done = await e.start(); assert.equal(done.status, 'failed')
  assert.deepEqual((await e.store.read(e.id)).library, before)
})

test('自由模式/空剧本阻止提取，提示词只带完整剧本和重要角色规则', () => {
  assert.ok(planRun({ mode: 'free', script: '回写内容' }, { to: 'project-characters' }).blockers.length)
  assert.ok(planRun({ mode: 'script', script: '' }, { to: 'project-characters' }).blockers.length)
  const p = projectCharacterPrompts({ mode: 'script', script: '首场与末场', library: { characters: [] } })
  assert.match(p.generation.user, /首场与末场/)
  assert.doesNotMatch(p.generation.user, /依据本集已通过大纲/)
  assert.match(p.generation.system, /无姓名角色默认不纳入/)
  assert.match(p.generation.system, /不因限制角色数量丢失细节/)
  assert.match(p.generation.system, /costumes/)
  assert.doesNotMatch(p.generation.system, /国籍未说明时默认中国|年龄、身高、体型、面相写具体/)
})

for (const change of ['script', 'cancel']) test(`${change}：生成中变更或取消不发布晚到角色`, async t => {
  const entered = Promise.withResolvers(), response = Promise.withResolvers()
  const e = await setup(t, async message => {
    if (message.skill === 'review') return reviewPass
    entered.resolve(); await response.promise
    return JSON.stringify({ items: [{ ...storyPackageFixture().characters.items[0], costumes: [outfit()] }] })
  })
  const { run } = await e.service.plan({ projectId: e.id, goal: { to: 'project-characters' } }, session)
  await e.service.confirm(e.id, run.id, session); await entered.promise
  if (change === 'script') await e.store.save(e.id, root => ({ ...root, script: '新的剧本', scriptRevision: 4 }))
  else await e.service.cancel(e.id, run.id, session)
  response.resolve(); await e.service.drain()
  const root = await e.store.read(e.id)
  assert.equal(root.library.characters.length, 0)
  assert.equal(root.projectCharacters, undefined)
})
