// 职责：验证自动生产流水线从剧情总览定稿到合成请求的推进、确认门槛、失败重拍与级联确认。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as pause } from 'node:timers/promises'
import { withConfig } from '../src/config.js'
import { createSkillsStore } from '../src/database/managers/skills.js'
import { createDirectorStore } from '../src/database/managers/directors.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createPipelineDriver } from '../src/server/projects/pipeline.js'
import { series, writeJob } from './fixtures/drama.mjs'

const skills = new URL('../../harness/.dsh/storages/elysium/pools/skills/', import.meta.url)
const timeline = { beats: [{ start: 0, end: 10, scene_id: 'room', roles: ['lin'], plot: '林打开信', emotion: '疑惑', dialogue: [{ role: 'lin', text: '是谁寄来的？', tone: '低声' }] }] }
const storyboard = { shots: [
  { scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '林打开信', duration: 5, dialogue: [{ role: 'lin', text: '是谁寄来的？' }] },
  { scene_id: 'room', roles: [], shot_size: '空镜', camera: '固定', action: '门口', duration: 5, dialogue: [] }] }

async function fixture(t, run) {
  const root = await mkdtemp(join(tmpdir(), 'elysium-pipeline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    for (const name of ['drama-planning', 'shot-planning']) await createSkillsStore().seed(name, new URL(`${name}/`, skills).pathname)
    const directors = createDirectorStore(), director = await directors.create({ display_name: '测试导演' })
    const llm = { calls: [], fail: 0, timeline, storyboard }
    const submissions = []
    const complete = async request => {
      llm.calls.push(request.name)
      if (llm.fail) { llm.fail--; throw Object.assign(new Error('模型输出无效'), { status: 502 }) }
      if (request.name === 'drama_timeline') return structuredClone(llm.timeline)
      if (request.name === 'drama_storyboard') return structuredClone(llm.storyboard)
      const shot = JSON.parse(request.user).storyboard.shots.find(item => item.id === JSON.parse(request.user).shot_id)
      return { prompt: `${shot.action} ${shot.dialogue.map(line => line.text).join(' ')} ${llm.calls.length}`, keyframe_prompt: `frame ${shot.action}` }
    }
    const submitTasks = async request => {
      submissions.push(request)
      const tasks = request.tasks.map((_, index) => ({ task_id: (submissions.length * 16 + index).toString(16).padStart(32, '0') }))
      for (const [index, task] of request.tasks.entries()) await writeJob(root, tasks[index].task_id, { project_id: request.project_id, status: 'pending', capability: task.kind === 'image' ? 'workflow-image' : 'workflow-video' })
      return { tasks }
    }
    const store = createProjectStore({ directorExists: name => directors.has(name), complete, submitTasks })
    const project = await store.change('create', { title: '雨夜的信', director: director.name, genre: '悬疑', synopsis: '信' })
    await store.planning.edit({ id: project.id, step: 'series', value: series(1) })
    await store.planning.finalize({ id: project.id, step: 'series', version: 1 })
    const drive = createPipelineDriver(store, null)
    // 反复对账，直到条件满足；LLM 步骤在后台执行，需要多轮 tick。
    const until = async (check, label) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        await drive()
        if (await check()) return
        await pause(5)
      }
      assert.fail(`等待超时：${label}`)
    }
    await run({ root, store, id: project.id, drive, until, llm, submissions })
  })
}
const shots = async (store, id) => (await store.readEpisode(id, 1)).acts[0]?.shots || []
const all = (items, check) => items.length === 2 && items.every(check)

test('pipeline plans every step, waits for anchor confirmation, produces shots and requests the episode film', async t => fixture(t, async ({ store, id, until, llm, submissions }) => {
  assert.deepEqual(submissions.map(item => item.tasks[0].binding.type), ['anchor'])
  await store.startAuto({ id })
  await until(async () => all(await shots(store, id), shot => shot.prompt_finalized), '规划全部定稿')
  assert.deepEqual(llm.calls, ['drama_timeline', 'drama_storyboard', 'drama_shot_prompt', 'drama_shot_prompt'])
  assert.ok((await shots(store, id)).every(shot => shot.prompt_finalized && !shot.job_id))
  await store.changeAnchor(id, 'update', { role: 'lin', source: { type: 'job', job_id: 'a'.repeat(32) }, image_needs_review: false })
  await until(async () => true, '一轮')
  assert.ok((await shots(store, id)).every(shot => !shot.job_id), '确认锚点前不提交镜头')
  await store.confirmAnchors({ id })
  await until(async () => all(await shots(store, id), shot => shot.job_id), '镜头提交')
  const produced = submissions.filter(item => item.tasks.length === 2)
  assert.equal(produced.length, 2)
  assert.deepEqual(produced.map(item => item.tasks.map(task => task.kind)), [['image', 'video'], ['image', 'video']])
  for (const shot of await shots(store, id)) await store.changeShot(id, { id: shot.id, episode: 1, status: 'succeeded' })
  await until(async () => (await store.readEpisode(id, 1)).film_task?.status === 'pending', '合成请求')
  assert.equal((await store.read(id)).auto.paused, null)
}))

test('failed shots are reshot once with a new take, then pause with a location; resume retries', async t => fixture(t, async ({ store, id, until }) => {
  await store.changeAnchor(id, 'update', { role: 'lin', source: { type: 'job', job_id: 'a'.repeat(32) }, image_needs_review: false })
  await store.startAuto({ id })
  await store.confirmAnchors({ id })
  await until(async () => all(await shots(store, id), shot => shot.job_id), '镜头提交')
  const first = (await shots(store, id))[0]
  await store.changeShot(id, { id: first.id, episode: 1, status: 'failed' })
  await until(async () => (await shots(store, id))[0].take === 2, '自动重拍')
  assert.equal((await store.read(id)).auto.attempts[`1/${first.id}`], 1)
  await store.changeShot(id, { id: first.id, episode: 1, status: 'failed' })
  await until(async () => (await store.read(id)).auto.paused, '暂停')
  assert.deepEqual((await store.read(id)).auto.paused, { reason: (await store.read(id)).auto.paused.reason, episode: 1, step: 'shot', shot_id: first.id })
  await store.resumeAuto({ id })
  assert.deepEqual((await store.read(id)).auto.attempts, {})
  await until(async () => (await shots(store, id))[0].take === 3, '继续后重拍')
}))

test('planning failures retry once then pause; upstream changes after production need confirmation to cascade', async t => fixture(t, async ({ store, id, until, llm }) => {
  llm.fail = 2
  await store.startAuto({ id })
  await until(async () => (await store.read(id)).auto.paused, '规划失败暂停')
  assert.deepEqual([(await store.read(id)).auto.paused.step, llm.calls.length], ['timeline', 2])
  await store.resumeAuto({ id })
  await store.changeAnchor(id, 'update', { role: 'lin', source: { type: 'job', job_id: 'a'.repeat(32) }, image_needs_review: false })
  await store.confirmAnchors({ id })
  await until(async () => all(await shots(store, id), shot => shot.job_id), '镜头提交')
  for (const shot of await shots(store, id)) await store.changeShot(id, { id: shot.id, episode: 1, status: 'succeeded' })
  llm.timeline = { beats: [{ ...timeline.beats[0], plot: '林撕开信封' }] }
  await store.planning.edit({ id, step: 'timeline', episode: 1, value: llm.timeline })
  await store.planning.finalize({ id, step: 'timeline', episode: 1, version: 2 })
  await until(async () => (await store.read(id)).auto.paused, '级联暂停')
  const paused = (await store.read(id)).auto.paused
  assert.deepEqual([paused.step, paused.episode], ['cascade', 1])
  assert.match(paused.reason, /本集已生成 2 镜/)
  const calls = llm.calls.length
  await store.resumeAuto({ id })
  assert.equal((await store.read(id)).auto.cascade_confirmed, true)
  await until(async () => llm.calls.length > calls && !(await store.readPlanning(id)).episodes[1].storyboard.needs_review, '级联重做分镜')
}))
