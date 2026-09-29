import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore, startExecution } from '../server/data/task-store.js'
import { generateEpisode, generateStoryPackage } from '../server/generate/story.js'
import { generateAllSeconds, generateShots } from '../server/generate/shot-text.js'
import { storyPackageFixture } from './fixtures/story-package.js'
import { reviewContent } from '../server/generate/review.js'
import { interruptRunning } from '../server/flow/tasks/restart.js'
import { createTasks } from '../server/flow/tasks/runner.js'

async function setup(t) {
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 return { ...e, history: recordStore(e.home, e.id) }
}
const summaryDeps = (e, request) => ({ home: e.home, generateEpisode: options => generateEpisode({ ...options, request }) })

test('summary history binds each review to its exact published version and retains failed newest content', async t => {
 const e = await setup(t); let calls = 0
 await runOperation(e.op('episode-generate', { origin: 'panel' }), summaryDeps(e, async ({ skill }) => {
  calls++
  return skill === 'skill-gongyong-content-review' ? 'FAIL 缺少因果' : JSON.stringify({ summary: calls === 1 ? '初稿' : '修订稿', durationSeconds: 10 })
 }))
 const [task] = await e.history.list(), artifacts = await e.history.list('artifacts')
 assert.equal(task.status, 'review_failed')
 assert.equal(task.source, 'panel')
 assert.equal((await e.read()).summary.content, '修订稿')
 // 计划在开始时写入，执行的步骤与计划一一对应（没有计划外步骤）。
 const steps = task.steps
 assert.deepEqual(steps.map(step => `${step.kind}:${step.target}`), ['generate:summary', 'review:summary', 'revise:summary', 're_review:summary'])
 assert.ok(steps.every(step => step.status === 'completed' && !step.unplanned))
 assert.deepEqual(steps.map(step => step.verdict), [null, 'fail', null, 'fail'])
 assert.deepEqual(steps[1].inputs, steps[0].outputs)
 assert.deepEqual(steps[3].inputs, steps[2].outputs)
 assert.ok(artifacts.every(item => item.published))
 assert.equal((await e.history.read('artifacts', (await e.read()).summary.source.artifactId)).content.summary, '修订稿')
})

test('review API error keeps saved new draft; generation error keeps previous content and source', async t => {
 const e = await setup(t)
 await assert.rejects(runOperation(e.op('episode-generate'), summaryDeps(e, async ({ skill }) => {
  if (skill === 'skill-gongyong-content-review') throw new Error('审核断网')
  return JSON.stringify({ summary: '已保存但未审核', durationSeconds: 10 })
 })), /审核断网/)
 let current = await e.read()
 assert.equal(current.summary.content, '已保存但未审核'); assert.equal(current.summary.check.passed, null)
 const source = current.summary.source
 await assert.rejects(runOperation(e.op('episode-generate'), summaryDeps(e, async () => { throw new Error('生成断网') })), /生成断网/)
 current = await e.read()
 assert.deepEqual(current.summary.source, source)
 const tasks = await e.history.list()
 assert.ok(tasks.every(task => task.status === 'failed'))
})

test('manual summary saves a pending version and immutable baseline', async t => {
 const e = await setup(t), before = await e.read()
 await runOperation(e.op('episode-edit', { fields: { summary: '人工新摘要', durationSeconds: 10 } }), { home: e.home })
 const current = await e.read(), [task] = await e.history.list()
 assert.equal(current.summary.check.passed, null)
 assert.equal(task.actor, 'human'); assert.equal(task.status, 'completed')
 const artifact = await e.history.read('artifacts', current.summary.source.artifactId)
 const baseline = await e.history.read('artifacts', artifact.previousArtifactId)
 assert.equal(baseline.content.summary, before.summary.content)
 assert.equal(artifact.content.summary, '人工新摘要')
})

test('story package, shot table and seconds each produce whole-episode records', async t => {
 const e = await setup(t)
 await runOperation(e.op('outline'), { home: e.home, generateStoryPackage: options => generateStoryPackage({ ...options, fetchImpl: async (_url, options) => {
  const request = JSON.parse(options.body)
  return Response.json({ choices: [{ message: { content: request.response_format ? JSON.stringify(storyPackageFixture()) : 'PASS' } }] })
 } }) })
 assert.ok((await e.read()).plot.source)
 const table = '## S01 / 5s\n第一镜\n## S02 / 5s\n第二镜'
 await runOperation(e.op('shots'), { home: e.home, generateShots: options => generateShots({ ...options, request: async ({ skill }) => skill === 'skill-gongyong-content-review' ? 'PASS' : table }) })
 assert.ok((await e.read()).shots.source)
 let calls = 0
 await runOperation(e.op('seconds'), { home: e.home, generateAllSeconds: options => generateAllSeconds({ ...options, request: async ({ skill }) => { calls++; return skill === 'skill-gongyong-content-review' ? 'PASS' : table + '\n[seconds-complete]' } }) })
 const seconds = (await e.history.list()).find(task => task.action === 'seconds')
 assert.equal(calls, 2)
 assert.equal(seconds.artifacts.length, 1)
 assert.equal(seconds.artifacts[0].target, 'seconds')
 assert.ok((await e.read()).shots.seconds.source)
})

test('manual text prompt review records the saved version', async t => {
 const e = await setup(t), project = await e.read(), old = project.shots.items[0].storyboard.content.prompt.text
 await runOperation(e.op('storyboard-text', { track: 'S01', originalText: old, text: old + '\n新增声音' }), {
  home: e.home, reviewContent: options => reviewContent({ ...options, request: async () => 'PASS' }),
 })
 const [task] = await e.history.list(), current = await e.read()
 assert.equal(task.actor, 'human')
 assert.deepEqual(task.steps.map(step => `${step.kind}:${step.target}:${step.status}`), ['save:storyboard:S01:completed', 'review:storyboard:S01:completed'])
 assert.ok(task.steps[1].inputs.includes(current.shots.items[0].storyboard.source.artifactId))
 assert.equal(task.steps[1].verdict, 'pass')
 assert.equal(current.shots.items[0].storyboard.check.passed, true)
})

test('restart cancels persisted running tasks; tasks can be read after service recreation', async t => {
 const e = await setup(t), id = randomUUID()
 await startExecution(e.home, e.op('seconds', { sessionId: 'session-test' }), id, [{ kind: 'generate', target: 'seconds' }, { kind: 'review', target: 'seconds' }])
 await interruptRunning(e.store)
 const task = await e.history.read('tasks', id)
 assert.equal(task.status, 'cancelled'); assert.deepEqual(task.steps.map(step => step.status), ['cancelled', 'pending']); assert.match(task.error, /服务重启/)
 const result = await createTasks({ home: e.home }).get(id, 'session-test')
 assert.equal(result.status, 'cancelled')
})

test('video completion records immutable filename and a failed retry preserves it', async t => {
 const e = await setup(t)
 const deps = { home: e.home, waitForBackground: true,
  submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: 'remote' })) }),
  retrieveFilm: async () => Buffer.from('video'), saveLastFrame: async () => Buffer.from('frame'),
 }
 await runOperation(e.op('film', { track: 'S01' }), deps)
 const before = (await e.read()).shots.items[0].video
 assert.ok(before.source)
 const record = await e.history.read('artifacts', before.source.artifactId)
 assert.equal(record.content.file, before.content.file)
 const task = await e.history.read('tasks', before.source.taskId)
 assert.ok(task.steps.find(step => step.kind === 'video_generate').outputs.includes(record.id))
 await runOperation(e.op('film', { track: 'S01' }), { ...deps, retrieveFilm: async () => { throw new Error('视频失败') } })
 const after = (await e.read()).shots.items[0].video
 assert.equal(after.content.file, before.content.file)
 assert.deepEqual(after.source, before.source)
 assert.ok((await e.history.list()).some(task => task.status === 'failed'))
 await access(join(e.home, 'storages', 'meiji', 'projects', e.id, 'films', e.episodeId, record.content.file))
})

test('deleting an episode removes its execution history and snapshots', async t => {
 const e = await setup(t)
 await runOperation(e.op('episode-edit', { fields: { summary: '保存历史', durationSeconds: 10 } }), { home: e.home })
 assert.ok((await e.history.list()).length)
 await runOperation(e.op('episode-delete'), { home: e.home })
 assert.deepEqual(await e.history.list(), [])
 assert.deepEqual(await e.history.list('artifacts'), [])
})

test('invalid shot table does not replace the current table or downstream content', async t => {
 const e = await setup(t), before = await e.read()
 await assert.rejects(runOperation(e.op('shots'), { home: e.home, generateShots: options => generateShots({ ...options, request: async () => '不是镜头表' }) }), /镜头表/)
 const after = await e.read()
 assert.equal(after.shots.items[0].content, before.shots.items[0].content)
})
