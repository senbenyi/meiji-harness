import { outlineFixture } from './fixtures/story-package.js'
import { promptData } from './fixtures/prompt-data.js'
import { secondsResponse, secondsContent, secondsForRequest } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from './fixtures/operation.js'
import { recordStore } from '../server/data/task-store.js'
import { generateAllSeconds } from './fixtures/seconds-generation.js'
import { buildSecondsPrompts } from '../server/prompts/shot-text-prompts.js'
import { feedbackOf, overrideBlocker } from '../shared/review-feedback.js'

async function environment(t) {
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 return e
}
const execute = (e, request, operation = {}, deps = {}) => runOperation(e.op('seconds', operation), {
 home: e.home, ...deps, request,
})
const reply = message => message.skill === 'review' ? reviewPass : secondsForRequest(message)

test('逐镜生成和审核，后镜引用本轮前镜完整指令，历史按镜头记录', async t => {
 const e = await environment(t), calls = []
 await execute(e, async message => { calls.push(message); return reply(message) })
 assert.equal(calls.length, 4)
 assert.deepEqual(calls.map(m => m.skill === 'review'), [false, true, false, true])
 assert.doesNotMatch(calls[0].user, /连续性参考：上一镜/)
 assert.match(calls[2].user, /连续性参考：上一镜每秒指令/)
 assert.match(calls[2].user, /第一镜新动作/)
 assert.ok(calls[2].user.includes(JSON.stringify(secondsContent('S01', 5, '第一镜新动作'))))
 const p = await e.read()
 assert.ok(p.shots.items.every(s => s.seconds.check.passed && !s.seconds.operation && !s.seconds.stale))
 assert.ok(p.shots.items.every(s => s.storyboard.content === null))
 assert.equal(p.shots.seconds.status, 'passed')
 const tasks = (await recordStore(e.home, e.id).list('tasks')).sort((a, b) => a.targets[0].localeCompare(b.targets[0]))
 assert.deepEqual(tasks.map(task => [task.type, task.label, task.status]), [['shot-seconds', '每秒指令 S01', 'completed'], ['shot-seconds', '每秒指令 S02', 'completed']])
 assert.deepEqual(tasks.flatMap(task => task.nodes).filter(s => s.status === 'completed').map(s => `${s.kind}:${s.target}`), ['generate:seconds:S01', 'review:seconds:S01', 'generate:seconds:S02', 'review:seconds:S02'])
 assert.ok(tasks.every(task => task.nodes.every(s => !s.unplanned)))
})

for (const count of [1, 2, 5]) test(`生成 ${count} 镜分别请求，不发整集请求`, async () => {
 const project = episodeFixture(), template = project.shots.items[0]
 project.shots.items = Array.from({ length: count }, (_, i) => ({ ...structuredClone(template), id: `S${String(i + 1).padStart(2, '0')}`, duration: i + 1 }))
 let generations = 0
 const shots = await generateAllSeconds({ project, request: async message => {
  if (message.skill === 'review') return reviewPass
  generations++
  return secondsForRequest(message, project.shots.items.map(s => [s.id, s.duration, `动作${s.id}`]))
 } })
 assert.equal(generations, count)
 for (const shot of shots.items) assert.equal(shot.seconds.content.beats[0].durationMs, shot.duration * 1000)
})

test('本镜剧情、关联资料与前镜指令用于生成、自审与修订，不带其他镜头表或后镜旧指令', () => {
 const p = episodeFixture()
 p.plot.outline.content = outlineFixture('大纲整体内容')
 p.shots.items[0].content = '不应提供的前镜镜头表'
 p.shots.items[1].content = '当前镜头表'
 p.shots.items.push({ ...structuredClone(p.shots.items[0]), id: 'S03', content: '不应提供的后镜镜头表', seconds: { ...p.shots.items[0].seconds, content: secondsContent('S03', 5, '不应提供的后镜指令') } })
 const prompts = buildSecondsPrompts({ project: p, shotId: 'S02' })
 for (const message of [prompts.generation, prompts.review('待审'), prompts.revision('失败稿', reviewFail('错误'))]) {
  assert.match(message.user, /当前镜头表/)
  assert.match(message.user, /大纲整体内容/)
  assert.ok(message.user.includes(JSON.stringify(p.shots.items[0].seconds.content)))
  assert.match(message.user, /上游事实：本镜关联人物/)
  assert.match(message.user, /上游事实：本镜关联场景/)
  assert.doesNotMatch(message.user, /不应提供的/)
 }
})

test('自动修订仅当前镜，后镜使用通过复审的最新前镜', async t => {
 const e = await environment(t); let firstGenerations = 0, firstReviews = 0
 await execute(e, async m => {
  const first = promptData(m.user, '【本次要求】').shotId === 'S01'
  if (m.skill === 'review') return first && ++firstReviews === 1 ? reviewFail('动作有误', 'S01') : reviewPass
  if (first) return secondsResponse([['S01', 5, ++firstGenerations === 1 ? '首稿' : '修订最终稿']])
  assert.match(m.user, /修订最终稿/); assert.doesNotMatch(m.user, /首稿/)
  return secondsForRequest(m)
 })
 assert.equal(firstGenerations, 2)
})

for (const failure of ['review', 'program', 'api', 'cancel']) test(`第二镜 ${failure} 失败：首镜保留且不请求第三镜`, async t => {
 const e = await environment(t), controller = new AbortController(), visited = []
 await e.store.save(e.id, p => { p.episodes[0].shots.items.push({ ...structuredClone(p.episodes[0].shots.items[1]), id: 'S03' }); return p })
 await assert.rejects(execute(e, async m => {
  const id = promptData(m.user, '【本次要求】').shotId; visited.push(id)
  if (id === 'S02') {
   if (failure === 'api') throw new Error('HTTP 503')
   if (failure === 'cancel') { controller.abort(); controller.signal.throwIfAborted() }
   if (m.skill === 'review') return failure === 'review' ? reviewFail('第二镜不通过', 'S02') : reviewPass
   return secondsResponse([['S02', failure === 'program' ? 4 : 5, '第二镜失败稿']])
  }
  return reply(m)
 }, {}, { signal: controller.signal }), /不通过|自审|自检|HTTP 503|abort/i)
 assert.ok(!visited.includes('S03'))
 const p = await e.read()
 assert.equal(p.shots.items[0].seconds.content.beats[0].action, '第一镜新动作')
 assert.equal(p.shots.items[0].seconds.status, 'passed')
 assert.ok(p.shots.items.every(s => !s.seconds.operation))
 assert.equal('activity' in p, false)
 if (failure === 'program') {
  assert.equal(p.shots.items[1].seconds.content.beats[0].action, '第二镜失败稿')
  assert.match(overrideBlocker(p, 'seconds'), /格式错误/)
 }
})

for (const invalid of ['truncated', 'foreign']) test(`${invalid} 响应不覆盖旧内容，失败原文留在历史`, async t => {
 const e = await environment(t), before = await e.read()
 const text = invalid === 'truncated' ? secondsResponse().slice(0, -8) : secondsResponse([['S02', 5, '错误镜头']])
 await assert.rejects(execute(e, async m => m.skill === 'review' ? reviewPass : text), /自审|自检/)
 const p = await e.read()
 assert.deepEqual(p.shots.items.map(s => s.seconds.content), before.shots.items.map(s => s.seconds.content))
 const records = recordStore(e.home, e.id), tasks = await records.list('tasks')
 // S01 审核不通过（修订用完），其后的 S02 按停止规则取消。
 const status = Object.fromEntries(tasks.map(item => [item.targets[0], item.status]))
 assert.deepEqual(status, { 'seconds:S01': 'review_failed', 'seconds:S02': 'cancelled' })
 const task = { artifacts: tasks.flatMap(item => item.artifacts) }
 const responses = await Promise.all(task.artifacts.filter(a => a.target === 'seconds-response').map(a => records.read('artifacts', a.artifactId)))
 // 生成 + 默认 2 轮修订，各保存一份原始响应。
 assert.equal(responses.length, 3)
 assert.ok(responses.every(a => a.content.text === text))
})

test('重新生成不带目标旧稿和旧意见', async t => {
 const e = await environment(t)
 await e.store.saveReviewDraft(e.id, e.episodeId, 'seconds', '不应提供的旧意见', 0)
 await execute(e, async m => { assert.doesNotMatch(m.user, /不应提供的旧意见|【修改基稿】/); return reply(m) }, { generationMode: 'regenerate' })
 assert.equal((await e.read()).shots.seconds.review.text, '不应提供的旧意见')
})

test('按意见修改逐镜使用本镜基稿，成功后消费统一意见，保留运行中新意见', async t => {
 const e = await environment(t); let generated = 0
 await e.store.saveReviewDraft(e.id, e.episodeId, 'seconds', '统一保持方向', 0)
 await execute(e, async m => {
  if (m.skill !== 'review') {
   assert.match(m.user, /【修改基稿】/); assert.match(m.user, /统一保持方向/)
   if (++generated === 1) await e.store.saveReviewDraft(e.id, e.episodeId, 'seconds', '下次新意见', 1)
  }
  return reply(m)
 }, { generationMode: 'modify' })
 assert.equal(generated, 2)
 assert.equal((await e.read()).shots.seconds.review.text, '下次新意见')
})

test('部分保存后可按失败原因修改，缺失镜头继续生成', async t => {
 const e = await environment(t)
 await e.store.save(e.id, p => { p.episodes[0].shots.items[1].seconds.content = null; return p })
 await assert.rejects(execute(e, async m => promptData(m.user, '【本次要求】').shotId === 'S02' ? m.skill === 'review' ? reviewFail('第二镜失败', 'S02') : secondsResponse([['S02', 4, '失败正文']]) : reply(m)), /自检|自审/)
 const calls = []
 await execute(e, async m => { calls.push(m); return reply(m) }, { generationMode: 'modify', review: '' })
 assert.match(calls.find(m => m.skill !== 'review' && promptData(m.user, '【本次要求】').shotId === 'S02').user, /失败正文|4000ms/)
 assert.ok((await e.read()).shots.items.every(s => s.seconds.check.passed))
})

test('storyboard never fills missing seconds in the background', async t => {
 const e = await environment(t)
 await e.store.save(e.id, p => { p.episodes[0].shots.items[1].seconds.content = null; return p })
 await assert.rejects(runOperation(e.op('film', { ...{}, parts: 'storyboard' }), { home: e.home, generateAllSeconds: () => assert.fail('no implicit fill') }), /请先.*每秒指令/)
})

test('首镜更新后后镜旧稿过期，失败停止后不能把旧稿用于下游', async t => {
 const e = await environment(t), before = await e.read()
 await assert.rejects(execute(e, async m => { if (promptData(m.user, '【本次要求】').shotId === 'S02') throw new Error('HTTP 503'); return reply(m) }), /HTTP 503/)
 const p = await e.read(), second = p.shots.items[1]
 assert.deepEqual(second.seconds.content, before.shots.items[1].seconds.content)
 assert.equal(second.seconds.stale, true)
 assert.notEqual(second.seconds.check.passed, true)
 assert.equal(second.storyboard.content, null)
 assert.equal(feedbackOf(p, 'seconds').status, 'failed')
})

test('取消当前镜审核保留已生成草稿，不开始后镜', async t => {
 const e = await environment(t), controller = new AbortController(); let calls = 0
 await assert.rejects(execute(e, async m => {
  calls++
  if (m.skill === 'review') { controller.abort(); controller.signal.throwIfAborted() }
  return reply(m)
 }, {}, { signal: controller.signal }), { name: 'AbortError' })
 assert.equal(calls, 2)
 const p = await e.read()
 assert.equal(p.shots.items[0].seconds.content.beats[0].action, '第一镜新动作')
 assert.notEqual(p.shots.items[0].seconds.check.passed, true)
 assert.ok(p.shots.items.every(s => !s.seconds.operation))
})

test('修改失败保留统一意见，成功后仅消费本次意见', async t => {
 const e = await environment(t)
 await e.store.saveReviewDraft(e.id, e.episodeId, 'seconds', '统一意见', 0)
 await assert.rejects(execute(e, async m => m.skill === 'review' ? reviewFail('失败', 'S01') : secondsForRequest(m), { generationMode: 'modify' }), /自检|自审/)
 assert.equal((await e.read()).shots.seconds.review.text, '统一意见')
 await execute(e, reply, { generationMode: 'modify' })
 assert.equal((await e.read()).shots.seconds.review.text, '')
})

test('运行中新输入的后镜意见不丢失', async t => {
 const e = await environment(t); let entered = false
 await execute(e, async m => {
  if (!entered && m.skill === 'review') {
   entered = true
   await e.store.saveReviewDraft(e.id, e.episodeId, 'seconds:S02', '新输入意见', 0)
  }
  return reply(m)
 })
 assert.equal((await e.read()).shots.items[1].seconds.review.text, '新输入意见')
})

test('缺少字段的当前镜失败稿仍可查看，不影响已通过前镜', async t => {
 const e = await environment(t), broken = secondsContent('S02', 5, '缺字段稿')
 delete broken.beats[0].dialogueIds
 await assert.rejects(execute(e, async m => m.skill === 'review' ? reviewPass : promptData(m.user, '【本次要求】').shotId === 'S02' ? JSON.stringify({ shots: [broken] }) : secondsForRequest(m)), /dialogueIds/)
 const p = await e.read()
 assert.equal(p.shots.items[0].seconds.check.passed, true)
 assert.deepEqual(p.shots.items[1].seconds.content, broken)
 assert.equal(feedbackOf(p, 'seconds').canModify, true)
})

test('缺失的后镜在修改模式下正常补齐，并使用本轮前镜', async t => {
 const e = await environment(t)
 await e.store.save(e.id, p => { p.episodes[0].shots.items[1].seconds.content = null; return p })
 await execute(e, async m => {
  if (m.skill !== 'review' && promptData(m.user, '【本次要求】').shotId === 'S02') {
   assert.doesNotMatch(m.user, /【修改基稿】/)
   assert.match(m.user, /第一镜新动作/)
  }
  return reply(m)
 }, { generationMode: 'modify', review: '保持方向，补齐缺失镜头' })
 assert.ok((await e.read()).shots.items.every(s => s.seconds.check.passed))
})
