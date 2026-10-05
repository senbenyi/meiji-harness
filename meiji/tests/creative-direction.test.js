import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { reviewPass } from './fixtures/review-result.js'
import { projectStore } from '../server/data/project-store.js'
import { buildEpisodePrompts } from '../server/prompts/episode-summary-prompts.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { materialize } from '../shared/episode-rules.js'
import { episodeWork } from '../client/project-overview-view.js'
import { creativeDirection } from '../shared/script-assembly.js'
import { StoryModel } from '../server/prompts/models/story-model.js'
import { ProjectSummaryModel } from '../server/prompts/models/project-summary-model.js'
import { ScriptRevisionModel } from '../server/prompts/models/script-revision-model.js'

test('真实生成通路首集回写后，第二集继续按方向生成，修改方向影响第三集且不改旧集', async t => {
  const home = await tempHome(t), store = projectStore(home), p = await store.create({ mode: 'free', premise: '人的创作方向', title: '寻亲' }), calls = []
  const request = async message => { calls.push(message); return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '本集剧情-' + calls.length }) }
  const generate = fields => runOperation({ action: 'summary', projectId: p.id, referenceDurationSeconds: 30, ...fields }, { home, request })
  await runOperation({ action: 'premise-edit', projectId: p.id, text: '寻亲冒险，主角逐步发现旧案线索' }, { home })
  await generate({ requirements: '先调查失踪案' })
  const first = await store.read(p.id)
  assert.equal(first.premise, '寻亲冒险，主角逐步发现旧案线索')
  assert.equal(first.mode, 'free'); assert.equal(first.scriptKind, 'assembled'); assert.ok(first.script)
  calls.length = 0
  await generate({})
  assert.match(calls[0].user, /生成第 2 集摘要/)
  assert.match(calls[0].user, /【AI 创作方向】\n寻亲冒险/)
  assert.match(calls[0].user, /持续指导每一集/)
  assert.match(calls[0].user, /【已回写剧情与后续参考】/)
  assert.match(calls[1].user, /遵循 AI 创作方向/)
  const before = await store.read(p.id)
  await runOperation({ action: 'premise-edit', projectId: p.id, text: 'NEW_DIRECTION 转向海岛寻找失踪姐姐' }, { home })
  assert.deepEqual((await store.read(p.id)).episodes, before.episodes)
  calls.length = 0
  await generate({ requirements: '本集先调查码头' })
  assert.match(calls[0].user, /生成第 3 集摘要/)
  assert.match(calls[0].user, /【AI 创作方向】\nNEW_DIRECTION/)
  assert.match(calls[0].user, /本集先调查码头/)
  const after = await store.read(p.id)
  for (const old of before.episodes) assert.deepEqual(after.episodes.find(episode => episode.id === old.id), old)
  assert.equal(after.premise, 'NEW_DIRECTION 转向海岛寻找失踪姐姐')
  assert.equal(materialize(after, after.episodes[0].id).mode, 'free')
  assert.equal(episodeWork(after, after.episodes[0].id).mode, 'free')
})

test('回写后重生成、人工修订、审核与自动修订均携带当前方向，导入剧本不注入隐藏方向', () => {
  const p = { scriptKind: 'assembled', script: '已回写剧情', premise: 'DIRECTION_ONLY_MARKER', summary: { content: '背景' }, episodes: [{ id: 'e1', durationSeconds: 30, summary: { content: '主角已到码头' } }] }
  for (const scriptKind of ['assembled', 'imported']) {
    const root = { ...p, mode: scriptKind === 'assembled' ? 'free' : 'script', scriptKind }, prompts = buildEpisodePrompts(root, 'e1')
    const modify = checkContext.run({ generationMode: 'modify', review: '保留结尾' }, () => buildEpisodePrompts(root, 'e1'))
    for (const message of [prompts.generation, prompts.review('当前摘要'), prompts.revision('失败摘要', '推进线索'), modify.generation, modify.review('修改摘要')]) {
      if (scriptKind === 'assembled') assert.match(message.user, /【AI 创作方向】\nDIRECTION_ONLY_MARKER/)
      else { assert.doesNotMatch(message.user, /DIRECTION_ONLY_MARKER|【AI 创作方向】/); assert.match(message.user, /【剧本】/); }
    }
    if (scriptKind === 'assembled') assert.match(prompts.generation.user, /重新生成第 1 集摘要/)
    else assert.match(prompts.generation.user, /参考剧本顺序/)
    assert.equal(creativeDirection(root), scriptKind === 'assembled' ? p.premise : '')
    const related = [new StoryModel('outline', { project: root }).toGenerateSegments(), new ProjectSummaryModel({ project: root }).toGenerateSegments(), new ScriptRevisionModel({ project: root, operation: { action: 'script-sync' }, facts: {} }).creation('generate')]
    for (const prompt of related) {
      if (scriptKind === 'assembled') assert.match(JSON.stringify(prompt), /DIRECTION_ONLY_MARKER/)
      else assert.doesNotMatch(JSON.stringify(prompt), /DIRECTION_ONLY_MARKER/)
    }
  }
})

test('方向编辑保留已有内容，导入剧本项目禁止编辑隐藏方向', async t => {
  const home = await tempHome(t), store = projectStore(home)
  const p = await store.create({ mode: 'script', title: '原剧本', script: '原始剧本' })
  await store.save(p.id, { premise: '旧创作意图保留在存储' })
  await assert.rejects(runOperation({ action: 'premise-edit', projectId: p.id, text: '新方向' }, { home }), /剧本模式不使用 AI 创作方向/)
  assert.equal((await store.read(p.id)).premise, '旧创作意图保留在存储')
  const blank = await store.create({ mode: 'free', premise: '人的创作方向', title: '新创作' })
  await assert.rejects(runOperation({ action: 'premise-edit', projectId: blank.id, text: '字'.repeat(1001) }, { home }), /最多 1000 字/)
  await runOperation({ action: 'premise-edit', projectId: blank.id, text: '长期方向' }, { home })
  assert.equal((await store.read(blank.id)).premise, '长期方向')
})


test('生成或手工保存首集摘要不写方向，AI 会话不能编辑方向', async t => {
  const home = await tempHome(t), store = projectStore(home)
  for (const action of ['summary', 'episode-add']) {
    const p = await store.create({ mode: 'free', premise: '人的创作方向', title: action })
    const fields = { requirements: '仅本集要求', durationSeconds: 30, summary: '人工摘要' }
    await runOperation({ action, projectId: p.id, referenceDurationSeconds: 30, requirements: fields.requirements, fields }, { home, request: async message => message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '本集摘要' }) })
    assert.equal((await store.read(p.id)).premise, '人的创作方向')
    await assert.rejects(runOperation({ action: 'premise-edit', projectId: p.id, origin: 'session', text: 'AI 改写方向' }, { home }), /只能由人在面板上执行/)
    assert.equal((await store.read(p.id)).premise, '人的创作方向')
  }
})
