import { tableResponse } from './fixtures/shot-response.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
// 正文版本快照归属任务步骤：每次生成/修订各留一版，审核绑定到确切版本；失败与重试不破坏已发布版本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { runStore } from '../server/data/run-store.js'
import { historyStore } from '../server/data/history-store.js'
import { storyPackageFixture, storyRequest } from './fixtures/story-package.js'
import { reviewContent } from '../server/flow/steps/step-review-edited-content.js'

async function setup(t) {
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 return { ...e, runs: runStore(e.home, e.id) }
}
const stepArtifacts = async (e, run, target) => (await Promise.all(run.steps.map(async step => (await e.runs.records(run.id, step.id, 'artifacts')).filter(item => item.target === target && !item.baseline).map(item => ({ ...item, kind: step.kind }))))).flat()

test('summary history binds each review to its exact published version and retains failed newest content', async t => {
 const e = await setup(t); let drafts = 0
 const versions = ['初稿', '修订稿', '二次修订稿']
 const failure = await runOperation(e.op('summary', { origin: 'panel' }), { home: e.home, request: async ({ skill }) => skill === 'review' ? reviewFail('缺少因果') : JSON.stringify({ summary: versions[drafts++], durationSeconds: 10 }) }).then(() => null, error => error)
 assert.match(failure.message, /自审未通过.*缺少因果/)
 assert.equal((await e.read()).summary.content, '二次修订稿')
 // 计划只含生成与自审；两轮修订与复审按审核结论动态追加并带轮次，最后一次复审用尽修订后任务结束。
 const steps = failure.run.steps.filter(step => step.target === 'summary')
 assert.deepEqual(steps.map(step => `${step.kind}${step.round ? '#' + step.round : ''}:${step.status}`), ['generate:done', 'review:done', 'revise#1:done', 're_review#1:done', 'revise#2:done', 're_review#2:failed'])
 assert.deepEqual(steps.filter(step => step.kind.includes('review')).map(step => step.output.passed), [false, false, false])
 const artifacts = (await stepArtifacts(e, failure.run, 'summary')).filter(item => versions.includes(item.content.summary))
 assert.deepEqual(artifacts.map(item => [item.kind, item.content.summary, item.published]), [['generate', '初稿', true], ['revise', '修订稿', true], ['revise', '二次修订稿', true]])
 assert.deepEqual(artifacts.map(item => item.version), [artifacts[0].version, artifacts[0].version + 1, artifacts[0].version + 2])
 const source = (await e.read()).summary.source
 assert.equal(source.artifactId, artifacts[2].id); assert.equal(source.runId, failure.run.id)
})

test('review API error keeps saved new draft; generation error keeps previous content and source', async t => {
 const e = await setup(t)
 await assert.rejects(runOperation(e.op('summary', {}), { home: e.home, request: async ({ skill }) => {
  if (skill === 'review') throw new Error('审核断网')
  return JSON.stringify({ summary: '已保存但未审核', durationSeconds: 10 })
 } }), /审核断网/)
 let current = await e.read()
 assert.equal(current.summary.content, '已保存但未审核'); assert.equal(current.summary.check.passed, null)
 const source = current.summary.source
 await assert.rejects(runOperation(e.op('summary', {}), { home: e.home, request: async () => { throw new Error('生成断网') } }), /生成断网/)
 current = await e.read()
 assert.equal(current.summary.content, '已保存但未审核')
 assert.deepEqual(current.summary.source, source)
})

test('manual summary edit saves as passed and leaves a project event instead of a task', async t => {
 const e = await setup(t)
 await runOperation(e.op('episode-edit', { fields: { summary: '人工新摘要', durationSeconds: 10 } }), { home: e.home })
 const current = await e.read()
 assert.equal(current.summary.content, '人工新摘要')
 assert.equal(current.summary.check.passed, true)
 assert.equal(current.summary.status, 'passed')
 assert.deepEqual(await e.runs.list(), [])
 assert.deepEqual((await historyStore(e.home, e.id).list('events')).map(event => [event.type, event.actor, event.episodeId]), [['episode-edit', 'human', e.episodeId]])
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

test('story, shot table and seconds each record their own versions on the producing steps', async t => {
 const e = await setup(t)
 await runOperation(e.op('story', {}), { home: e.home, request: storyRequest(storyPackageFixture()) })
 await runOperation(e.op('characters'), { home: e.home, request: storyRequest(storyPackageFixture()) })
 for (const key of ['outline', 'characters']) assert.ok((await e.read()).plot[key].source.stepId, key)
 assert.deepEqual((await e.read()).plot.scenes.items, [])
 assert.deepEqual((await e.read()).plot.props.items, [])
 const table = '## S01 / 5s\n第一镜\n## S02 / 5s\n第二镜'
 await runOperation(e.op('shot-table', {}), { home: e.home, request: async ({ skill }) => skill === 'review' ? reviewPass : tableResponse(table) })
 assert.ok((await e.read()).shots.source.stepId)
 let calls = 0
 await runOperation(e.op('seconds'), { home: e.home, request: async message => { calls++; return message.skill === 'review' ? reviewPass : secondsForRequest(message).replaceAll('【庭院|E01】', '庭院') } })
 assert.equal(calls, 4)
 // 每镜的生成步骤各保存本镜正文与原始响应。
 const run = await latestRun(e.home, e.id)
 for (const track of ['S01', 'S02']) {
  const [generate] = run.steps.filter(step => step.target === `seconds:${track}` && step.kind === 'generate')
  const targets = (await e.runs.records(run.id, generate.id, 'artifacts')).filter(item => !item.baseline).map(item => item.target)
  assert.ok(targets.includes(`seconds:${track}`), track); assert.ok(targets.includes('seconds-response'), track)
 }
 const shots = (await e.read()).shots.items
 assert.deepEqual(shots.map(shot => shot.seconds.source.runId), [run.id, run.id])
})

test('manual text prompt edit outside any task is reviewed immediately against the saved version', async t => {
 const e = await setup(t), project = await e.read(), old = project.shots.items[0].storyboard.content.prompt.text
 let reviewed
 await runOperation(e.op('storyboard-text', { track: 'S01', originalText: old, text: compileVideoPrompt(project, project.shots.items[0]).prompt.text }), {
  home: e.home, reviewContent: options => { reviewed = options.text; return reviewContent({ ...options, request: async () => reviewPass }) },
 })
 const current = await e.read()
 assert.equal(reviewed, current.shots.items[0].storyboard.content.prompt.text)
 assert.equal(current.shots.items[0].storyboard.check.passed, true)
 assert.deepEqual((await historyStore(e.home, e.id).list('events')).map(event => event.type), ['storyboard-text'])
})

test('video completion records immutable filename and a failed retry preserves it', async t => {
 const e = await setup(t)
 const deps = { home: e.home,
  submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: 'remote' })) }),
  retrieveGatewayVideo: async () => Buffer.from('video'), saveLastFrame: async () => Buffer.from('frame'),
 }
 await runOperation(e.op('film', { track: 'S01' }), deps)
 const before = (await e.read()).shots.items[0].video
 const record = await e.runs.readRecord('artifacts', before.source.artifactId)
 assert.equal(record.content.file, before.content.file)
 assert.equal(record.runId, before.source.runId); assert.equal(record.stepId, before.source.stepId)
 const run = await e.runs.read(before.source.runId)
 assert.equal(run.steps.find(step => step.id === before.source.stepId).kind, 'video')
 await assert.rejects(runOperation(e.op('film', { track: 'S01', parts: 'video' }), { ...deps, retrieveGatewayVideo: async () => { throw new Error('视频失败') } }), /视频失败/)
 const after = (await e.read()).shots.items[0].video
 assert.equal(after.content.file, before.content.file)
 assert.deepEqual(after.source, before.source)
 await access(join(e.home, 'storages', 'meiji', 'projects', e.id, 'films', e.episodeId, record.content.file))
})

test('deleting an episode removes its tasks and snapshots', async t => {
 const e = await setup(t)
 await runOperation(e.op('summary', {}), { home: e.home, request: async ({ skill }) => skill === 'review' ? reviewPass : JSON.stringify({ summary: '保存历史', durationSeconds: 10 }) })
 assert.equal((await e.runs.list()).filter(run => run.episodeId === e.episodeId).length, 1)
 assert.ok((await e.runs.listRecords('artifacts')).some(item => item.episodeId === e.episodeId))
 await runOperation(e.op('episode-delete'), { home: e.home })
 assert.deepEqual((await e.runs.list()).filter(run => run.episodeId === e.episodeId), [])
 for (const kind of ['prompts', 'responses', 'artifacts']) assert.deepEqual((await e.runs.listRecords(kind)).filter(item => item.episodeId === e.episodeId), [], kind)
})

test('invalid shot table does not replace the current table', async t => {
 const e = await setup(t), before = await e.read()
 await assert.rejects(runOperation(e.op('shot-table', {}), { home: e.home, request: async ({ skill }) => skill === 'review' ? reviewPass : '不是镜头表' }), /格式无效/)
 const after = await e.read()
 assert.deepEqual(after.shots.items.map(shot => shot.content), before.shots.items.map(shot => shot.content))
})
