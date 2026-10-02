import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { summaryLength, episodeSummaryFailures } from '../shared/episode-summary.js'
import { generateEpisode, normalizeEpisodeDraft } from '../server/generate/story.js'
import { buildEpisodePrompts } from '../server/prompts/episode-prompts.js'
import { previewPrompts } from '../server/prompts/preview.js'
import { builtinSkillSet, skillStore, additionsPatch } from '../server/data/skill-store.js'
import { setupModel } from './fixtures/model.js'
import { createTasks } from '../server/flow/tasks/runner.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore } from '../server/data/task-store.js'
import { scopeProjects, editEpisode, overviewPatch } from '../server/data/episodes.js'
import { modelStore } from '../server/data/model-settings.js'
import { modelRoutes } from '../models/model-config.js'
import { generateGatewayImage, submitGatewayVideo, retrieveGatewayVideo } from '../server/generate/gateway.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const project = { title: '故事', summary: { content: '总故事方向' }, episodes: [] }
const draft = (summary = '本集事件', durationSeconds = 150) => ({ summary, durationSeconds })

test('300 字按 Unicode 计数，标点计入；时长由用户设定，忽略模型返回的时长', () => {
  assert.equal(summaryLength('😀 中\n。\t'), 3)
  for (const n of [1, 999, '150', undefined]) assert.deepEqual(episodeSummaryFailures(draft('字'.repeat(300), n)), [])
  for (const value of [draft('字'.repeat(301)), draft(' ')]) assert.throws(() => normalizeEpisodeDraft(value), /摘要/)
  assert.equal(normalizeEpisodeDraft(draft('长集', 210), 200).durationSeconds, 200)
  assert.equal(normalizeEpisodeDraft({ summary: '只有摘要' }).durationSeconds, 150)
})

test('超长结果即使 AI 审核 PASS 也只修订一次，本集时长始终为用户设定值', async () => {
  const replies = [JSON.stringify(draft('字'.repeat(301), 171)), reviewPass, JSON.stringify(draft('修正后的事件', 99)), reviewPass]
  const messages = [], saved = []
  const result = await generateEpisode({ project, referenceDurationSeconds: 150,
    request: async message => { messages.push(message); return replies.shift() }, persist: value => saved.push(value) })
  assert.equal(result.durationSeconds, 150)
  assert.equal(messages.length, 4)
  for (const message of messages) assert.match(message.user, /本集时长：150 秒（用户设定/)
  for (const message of messages) assert.doesNotMatch(message.user + message.system, /130–170|上下 20/)
  assert.match(messages[2].user, /300 字/)
  assert.ok(saved.every(value => value.summary === '修正后的事件' && value.durationSeconds === 150))
})

test('最终仍违规时拒绝结果、不保存无效内容、不再重试', async () => {
  let calls = 0, saves = 0
  await assert.rejects(generateEpisode({ project, request: async ({ skill }) => { calls++; return skill === 'review' ? reviewPass : JSON.stringify(draft('字'.repeat(301))) }, persist: () => { saves++ } }), /300 字/)
  assert.equal(calls, 4)
  assert.equal(saves, 0)
})

test('新建摘要实际与预览共用固定约束；约束不能覆盖或补充', async t => {
  const e = await setupModel(t), root = await e.store.read(e.id)
  const actual = buildEpisodePrompts(root, e.episodeId).generation
  const preview = previewPrompts({ stage: 'episode', root, view: await e.read(), skillSet: builtinSkillSet(root.skills) })
  assert.ok(actual.system.includes('【基础生产规则】'))
  assert.ok(actual.system.includes('最多 300 字'))
  assert.deepEqual(preview.generate.system, actual.segments.system)
  await assert.rejects(skillStore(e.home).save('episode', { constraints: '改规则' }), /不可编辑/)
  await assert.rejects(skillStore(e.home).save('episode', { generate: '旧字段' }), /不可编辑/)
  assert.throws(() => additionsPatch(root.skills, 'episode', { generate: '旧字段' }), /不可补充/)
})

test('草稿任务持久化并可重新查询，保存前项目文件不变', async t => {
  const e = await setupModel(t)
  const file = join(e.home, 'storages/meiji/projects', e.id + '.json'), before = await readFile(file, 'utf8')
  const tasks = createTasks({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps, generateEpisode: opts => generateEpisode({ ...opts, request: async ({ skill }) => skill === 'review' ? reviewPass : JSON.stringify(draft()) }) }) })
  const task = tasks.start({ action: 'episode-summary-draft', projectId: e.id, referenceDurationSeconds: 150, origin: 'panel' })
  const result = await tasks.wait(task.id)
  assert.equal(result.status, 'completed')
  assert.equal(result.draft.summary, '本集事件')
  assert.equal(await readFile(file, 'utf8'), before)
  const resumed = await createTasks({ home: e.home }).get(task.id, null)
  assert.deepEqual(resumed.draft, result.draft)
  const record = await recordStore(e.home, e.id).read('tasks', task.id)
  assert.ok(record.steps.every(step => !step.unplanned))
  assert.equal(record.latestOutputs[0].target, 'summary-draft')
})

test('已有剧集重新生成保留用户设定的时长、不采用 AI 返回值，手工及 source 入口都遵守 300 字', async t => {
  const e = await setupModel(t)
  await runOperation(e.op('episode-generate', { referenceDurationSeconds: 150 }), { home: e.home,
    generateEpisode: opts => generateEpisode({ ...opts, request: async ({ skill }) => skill === 'review' ? reviewPass : JSON.stringify(draft('新摘要', 165)) }) })
  assert.equal((await e.read()).durationSeconds, 150)
  const root = await e.store.read(e.id)
  assert.throws(() => editEpisode(root, e.episodeId, draft('字'.repeat(301))), /300/)
  await assert.rejects(scopeProjects(e.store, e.episodeId).saveSource(e.id, { summary: '字'.repeat(301) }), /300/)
  assert.equal(overviewPatch(root, { summary: '字'.repeat(301) }).summary.content.length, 301)
})

test('无密钥时已组装提示词并记录技能，但不 fetch、不改变剧集', async t => {
  const e = await setupModel(t), models = modelStore(e.home)
  await models.write({ ...await models.read(), apiKey: '' })
  const original = await e.read()
  let network = 0
  t.mock.method(globalThis, 'fetch', async () => { network++; throw new Error('不应访问网络') })
  await assert.rejects(runOperation({ action: 'episode-summary-draft', projectId: e.id, referenceDurationSeconds: 150 }, { home: e.home }), /需要网关密钥/)
  assert.deepEqual(await e.read(), original)
  assert.equal(network, 0)
  const [record] = await recordStore(e.home, e.id).list()
  assert.ok(record.skills.some(skill => skill.id === 'episode'))
  assert.equal(record.steps[0].kind, 'generate')
  assert.equal(record.steps[0].apiFailure, true)
})

test('只校验当前路由；图像、编辑、视频提交及轮询在发请求时拒绝空密钥', async () => {
  const routes = modelRoutes({ baseUrl: 'https://gateway.test/v1', apiKey: 'key', story: { model: 'story' } })
  await generateEpisode({ project, route: routes.story, fetchImpl: async (_url, options) => Response.json({ choices: [{ message: { content: JSON.parse(options.body).messages[0].content.includes('【本次审核协议】') ? reviewPass : JSON.stringify(draft()) } }] }) })
  const base = { baseUrl: 'https://gateway.test/v1', apiKey: '', model: 'test', prompt: '提示词', fetchImpl: async () => { throw new Error('不应访问网络') } }
  await assert.rejects(generateGatewayImage(base), /需要网关密钥/)
  await assert.rejects(generateGatewayImage({ ...base, references: [{ bytes: Buffer.from('image'), mime: 'image/png' }] }), /需要网关密钥/)
  await assert.rejects(submitGatewayVideo({ ...base, duration: 5, mode: 'text' }), /需要网关密钥/)
  await assert.rejects(retrieveGatewayVideo({ ...base, promptId: 'job' }), /需要网关密钥/)
  await assert.rejects(generateGatewayImage({ ...base, apiKey: 'key', model: '', references: [{ bytes: Buffer.from('image'), mime: 'image/png' }] }), /模型名/)
})

test('审核失败候选保存在任务历史，原项目不变，也不能伪装成成功', async t => {
  const e = await setupModel(t), before = await e.store.read(e.id)
  const tasks = createTasks({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps,
    generateEpisode: opts => generateEpisode({ ...opts, request: async ({ skill }) => skill === 'review' ? reviewFail('结尾未衔接') : JSON.stringify(draft()) }) }) })
  const task = tasks.start({ action: 'episode-summary-draft', projectId: e.id, referenceDurationSeconds: 150, origin: 'panel' })
  const result = await tasks.wait(task.id)
  assert.equal(result.status, 'review_failed')
  assert.equal(result.draft.check.passed, false)
  assert.deepEqual(await e.store.read(e.id), before)
  assert.deepEqual((await createTasks({ home: e.home }).get(task.id, null)).draft, result.draft)
})

test('停止摘要草稿会中止请求，保留已有剧集和下游内容', async t => {
  const e = await setupModel(t), before = await e.store.read(e.id)
  let started
  const ready = new Promise(resolve => { started = resolve })
  const tasks = createTasks({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps,
    generateEpisode: opts => generateEpisode({ ...opts, request: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started()
    }) }) }) })
  const task = tasks.start(e.op('episode-summary-draft', { origin: 'panel' }))
  await ready
  tasks.cancel(task.id, e.id)
  const result = await tasks.wait(task.id)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.draft, undefined)
  assert.deepEqual(await e.store.read(e.id), before)
})
