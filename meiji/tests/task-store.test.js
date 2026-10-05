import { tableResponse } from './fixtures/shot-response.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from './fixtures/operation.js'
import { recordStore } from '../server/data/task-store.js'
import { startExecution } from '../server/runtime/task-execution.js'
import { generateEpisode } from '../server/flow/tasks/text/task-summary.js'
import { generateStoryPackage } from './fixtures/story-generation.js'
import { generateAllSeconds } from './fixtures/seconds-generation.js'
import { generateShots } from '../server/flow/tasks/text/task-shot-table.js'
import { storyPackageFixture, outlineFixture, outlineResponse } from './fixtures/story-package.js'
import { reviewContent } from '../server/runtime/text-generation.js'
import { interruptRunning } from '../server/flow/tasks/task-interrupt.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'

async function setup(t) {
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 return { ...e, history: recordStore(e.home, e.id) }
}
const summaryDeps = (e, request) => ({ home: e.home, generateEpisode: options => generateEpisode({ ...options, request }) })

test('summary history binds each review to its exact published version and retains failed newest content', async t => {
 const e = await setup(t); let drafts = 0
 const versions = ['初稿', '修订稿', '二次修订稿']
 await runOperation(e.op('summary', { origin: 'panel' }), summaryDeps(e, async ({ skill }) => {
  return skill === 'review' ? reviewFail('缺少因果') : JSON.stringify({ summary: versions[drafts++], durationSeconds: 10 })
 }))
 const task = (await e.history.list()).find(item => item.type === 'summary'), artifacts = (await e.history.list('artifacts')).filter(item => item.target === 'summary')
 assert.equal(task.status, 'review_failed')
 assert.equal(task.source, 'panel')
 assert.equal((await e.read()).summary.content, '二次修订稿')
 // 计划只含生成与自审；两轮修订与复审按自审结论动态追加，带轮次，均不是计划外步骤。
 const nodes = task.nodes
 assert.deepEqual(nodes.map(step => `${step.kind}${step.round ? '#' + step.round : ''}:${step.target}`), ['generate:summary', 'review:summary', 'revise#1:summary', 're_review#1:summary', 'revise#2:summary', 're_review#2:summary'])
 assert.ok(nodes.every(step => step.status === 'completed' && !step.unplanned))
 assert.deepEqual(nodes.map(step => step.verdict), [null, 'fail', null, 'fail', null, 'fail'])
 assert.deepEqual(nodes[1].inputs, nodes[0].outputs)
 assert.deepEqual(nodes[3].inputs, nodes[2].outputs)
 assert.deepEqual(nodes[5].inputs, nodes[4].outputs)
 assert.ok(artifacts.every(item => item.published))
 assert.equal((await e.history.read('artifacts', (await e.read()).summary.source.artifactId)).content.summary, '二次修订稿')
})

test('review API error keeps saved new draft; generation error keeps previous content and source', async t => {
 const e = await setup(t)
 await assert.rejects(runOperation(e.op('summary', {}), summaryDeps(e, async ({ skill }) => {
  if (skill === 'review') throw new Error('审核断网')
  return JSON.stringify({ summary: '已保存但未审核', durationSeconds: 10 })
 })), /审核断网/)
 let current = await e.read()
 assert.equal(current.summary.content, '已保存但未审核'); assert.equal(current.summary.check.passed, null)
 const source = current.summary.source
 await assert.rejects(runOperation(e.op('summary', {}), summaryDeps(e, async () => { throw new Error('生成断网') })), /生成断网/)
 current = await e.read()
 assert.deepEqual(current.summary.source, source)
 const tasks = (await e.history.list()).filter(item => item.type === 'summary')
 assert.ok(tasks.every(task => task.status === 'failed'))
})

test('manual summary saves a pending version and immutable baseline', async t => {
 const e = await setup(t), before = await e.read()
 await runOperation(e.op('episode-edit', { fields: { summary: '人工新摘要', durationSeconds: 10 } }), { home: e.home })
 const current = await e.read(), task = (await e.history.list()).find(item => item.type === 'save')
 assert.equal(current.summary.check.passed, true)
 assert.equal(current.summary.status, 'passed')
 assert.equal(task.actor, 'human'); assert.equal(task.status, 'completed')
 const artifact = await e.history.read('artifacts', current.summary.source.artifactId)
 const baseline = await e.history.read('artifacts', artifact.previousArtifactId)
 assert.equal(baseline.content.summary, before.summary.content)
 assert.equal(artifact.content.summary, '人工新摘要')
})

test('manual episode add and edit save as passed and clear failure reasons', async t => {
 const e = await setup(t)
 await e.store.save(e.id, project => { const summary = project.episodes[0].summary; summary.check = { passed: false, failures: ['旧的未通过原因'], revision: summary.revision }; summary.status = 'failed'; return project })
 const current = await e.read()
 await runOperation(e.op('episode-edit', { fields: { summary: current.summary.content, durationSeconds: current.durationSeconds } }), { home: e.home })
 const unchanged = (await e.read()).summary
 assert.equal(unchanged.status, 'passed'); assert.equal(unchanged.check.passed, true); assert.deepEqual(unchanged.check.failures, [])
 await runOperation(e.op('episode-edit', { fields: { summary: '人工修改后的摘要', durationSeconds: 12 } }), { home: e.home })
 const edited = (await e.read()).summary
 assert.equal(edited.status, 'passed'); assert.equal(edited.check.passed, true); assert.deepEqual(edited.check.failures, [])
 await runOperation(e.op('episode-add', { fields: { summary: '手动新增的第二集', durationSeconds: 10 } }), { home: e.home })
 const added = (await e.store.read(e.id)).episodes[0].summary
 assert.equal(added.content, '手动新增的第二集')
 assert.equal(added.status, 'passed'); assert.equal(added.check.passed, true); assert.deepEqual(added.check.failures, [])
})

test('story package, shot table and seconds each produce whole-episode records', async t => {
 const e = await setup(t), fixture = storyPackageFixture()
 const replies = [outlineResponse(), reviewPass, JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify(fixture.props), reviewPass]
 await runOperation(e.op('story', {}), { home: e.home, fetchImpl: async () => {
  return Response.json({ choices: [{ message: { content: replies.shift() } }] })
 } })
 for (const key of ['outline', 'characters', 'scenes', 'props']) assert.ok((await e.read()).plot[key].source)
 const table = '## S01 / 5s\n第一镜\n## S02 / 5s\n第二镜'
 await runOperation(e.op('shot-table', {}), { home: e.home, generateShots: options => generateShots({ ...options, request: async ({ skill }) => skill === 'review' ? reviewPass : tableResponse(table) }) })
 assert.ok((await e.read()).shots.source)
 let calls = 0
 await runOperation(e.op('seconds'), { home: e.home, request: async message => { calls++; return message.skill === 'review' ? reviewPass : secondsForRequest(message) } })
 const secondsTasks = (await e.history.list()).filter(task => task.action === 'seconds')
 assert.equal(calls, 4)
 // 每镜一个任务，产物记在各自任务上。
 assert.deepEqual(secondsTasks.map(task => task.targets[0]).sort(), ['seconds:S01', 'seconds:S02'])
 const seconds = { artifacts: secondsTasks.flatMap(task => task.artifacts) }
 assert.deepEqual(seconds.artifacts.map(item => item.target).sort(), ['seconds', 'seconds', 'seconds-response', 'seconds-response', 'seconds:S01', 'seconds:S02'])
 assert.ok((await e.read()).shots.seconds.source)
})

test('manual text prompt review records the saved version', async t => {
 const e = await setup(t), project = await e.read(), old = project.shots.items[0].storyboard.content.prompt.text
 await runOperation(e.op('storyboard-text', { track: 'S01', originalText: old, text: compileVideoPrompt(project, project.shots.items[0]).prompt.text }), {
  home: e.home, reviewContent: options => reviewContent({ ...options, request: async () => reviewPass }),
 })
 const task = (await e.history.list()).find(item => item.type === 'save'), current = await e.read()
 assert.equal(task.actor, 'human')
 assert.deepEqual(task.nodes.map(step => `${step.kind}:${step.target}:${step.status}`), ['save:storyboard:S01:completed', 'review:storyboard:S01:completed'])
 assert.ok(task.nodes[1].inputs.includes(current.shots.items[0].storyboard.source.artifactId))
 assert.equal(task.nodes[1].verdict, 'pass')
 assert.equal(current.shots.items[0].storyboard.check.passed, true)
})

test('restart cancels persisted running tasks; tasks can be read after service recreation', async t => {
 const e = await setup(t), id = randomUUID()
 await startExecution(e.home, e.op('seconds', { sessionId: 'session-test' }), id, [{ kind: 'generate', target: 'seconds' }, { kind: 'review', target: 'seconds' }])
 await interruptRunning(e.store)
 const task = await e.history.read('tasks', id)
 assert.equal(task.status, 'cancelled'); assert.deepEqual(task.nodes.map(step => step.status), ['cancelled', 'pending']); assert.match(task.error, /服务重启/)
 assert.equal((await e.history.read('tasks', id)).status, 'cancelled')
})

test('video completion records immutable filename and a failed retry preserves it', async t => {
 const e = await setup(t)
 const deps = { home: e.home, waitForBackground: true,
  submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: 'remote' })) }),
  retrieveGatewayVideo: async () => Buffer.from('video'), saveLastFrame: async () => Buffer.from('frame'),
 }
 await runOperation(e.op('film', { track: 'S01' }), deps)
 const before = (await e.read()).shots.items[0].video
 assert.ok(before.source)
 const record = await e.history.read('artifacts', before.source.artifactId)
 assert.equal(record.content.file, before.content.file)
 const task = await e.history.read('tasks', before.source.taskId)
 assert.ok(task.nodes.find(step => step.kind === 'video_generate').outputs.includes(record.id))
 await assert.rejects(runOperation(e.op('film', { track: 'S01', parts: 'video' }), { ...deps, retrieveGatewayVideo: async () => { throw new Error('视频失败') } }), /视频失败/)
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
 assert.ok((await e.history.list()).every(task => task.type === 'script-sync'))
 assert.ok((await e.history.list('artifacts')).every(artifact => artifact.kind === 'script-proposal'))
})

test('invalid shot table does not replace the current table or downstream content', async t => {
 const e = await setup(t), before = await e.read()
 await assert.rejects(runOperation(e.op('shot-table', {}), { home: e.home, generateShots: options => generateShots({ ...options, request: async ({skill}) => skill==='review'?reviewPass:'不是镜头表' }) }), /JSON|镜头表/)
 const after = await e.read()
 assert.equal(after.shots.items[0].content, before.shots.items[0].content)
})
