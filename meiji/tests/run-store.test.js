import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runStore } from '../server/data/run-store.js'

const value = (id, episodeId = 'episode') => ({ schemaVersion: 1, id, projectId: 'project', episodeId, revision: 0, pause: null, events: [{ type: 'created' }], steps: [{ id: 'step', key: 'generate@summary', kind: 'generate', target: 'summary', scope: 'episode', queue: 'text', after: [], status: 'pending', prompts: [], responses: [], artifacts: [] }] })
async function setup(t) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-runs-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  return { home, store: runStore(home, 'project'), root: join(home, 'storages/meiji/projects/project/history') }
}

test('两个存储实例并发创建同集只准入一个，draft 和 paused 都占归属', async t => {
  const { home, store } = await setup(t)
  const outcomes = await Promise.allSettled([store.create(value('a')), runStore(home, 'project').create(value('b'))])
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'RUN_AMEND_REQUIRED')
  assert.equal((await store.openRun('episode')).id, 'a')
  await store.update('a', run => { run.events.push({ type: 'confirmed' }); run.steps[0].status = 'paused'; return run })
  await assert.rejects(store.create(value('c')), { code: 'RUN_AMEND_REQUIRED', runId: 'a' })
  await store.update('a', run => { run.steps[0].status = 'done'; return run })
  assert.ok((await store.read('a')).endedAt)
  await store.create(value('c'))
  assert.equal((await store.openRun('episode')).id, 'c')
})

test('串行更新不丢事件，写入权限 0600 且失败不遗留临时文件', async t => {
  const { store, root } = await setup(t)
  await store.create(value('run'))
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update('run', run => { run.events.push({ type: 'feedback', payload: i }); return run })))
  assert.equal((await store.read('run')).events.length, 21)
  assert.equal((await store.read('run')).revision, 21)
  assert.equal((await stat(join(root, 'runs/run.json'))).mode & 0o777, 0o600)
  await assert.rejects(store.update('run', run => ({ ...run, episodeId: 'other' })), /归属/)
  await assert.rejects(store.update('run', run => { run.steps[0].after = ['missing']; return run }), /不存在/)
  assert.deepEqual(await readdir(join(root, 'runs')), ['run.json'])
  assert.deepEqual((await store.read('run')).steps[0].after, [])
})

test('快照按 Run 和 Step 归属读取，拒绝跨任务伪引用与路径穿越', async t => {
  const { store, root } = await setup(t)
  await store.create(value('a'))
  await store.create(value('b', 'other'))
  for (const kind of ['prompts', 'responses', 'artifacts']) {
    const record = await store.record('a', 'step', kind, { text: kind, runId: 'b', stepId: 'wrong' })
    assert.equal(record.runId, 'a'); assert.equal(record.stepId, 'step')
    assert.equal((await store.records('a', 'step', kind))[0].text, kind)
    assert.equal((await stat(join(root, 'run-' + kind, record.id + '.json'))).mode & 0o777, 0o600)
    await store.update('b', run => { run.steps[0][kind] = [record.id]; return run })
    await assert.rejects(store.records('b', 'step', kind), { status: 404 })
  }
  await assert.rejects(store.records('a', 'missing', 'prompts'), { status: 404 })
  await assert.rejects(store.read('../a'), /ID/)
  assert.throws(() => runStore(root, '../project'), /ID/)
})

test('重启中断直接结束任务：运行中的步骤记为 failed，未开始的作废，写 endedAt 且只处理一次', async t => {
  const { store } = await setup(t)
  await store.create(value('run'))
  await store.update('run', run => {
    run.events.push({ type: 'confirmed' }); run.steps[0].status = 'running'
    run.steps.push({ ...run.steps[0], id: 'pending', key: 'generate@pending', status: 'pending' })
    return run
  })
  assert.equal((await store.interrupt()).length, 1)
  const run = await store.read('run')
  assert.equal(run.status, 'failed'); assert.ok(run.endedAt)
  assert.equal(run.steps[0].status, 'failed'); assert.equal(run.steps[1].status, 'superseded')
  assert.equal(run.pause, null)
  assert.deepEqual([run.failure.code, run.failure.stepId], ['interrupted', run.steps[0].id])
  assert.deepEqual(await store.interrupt(), [])
})

test('旧版本因执行失败或审核用尽而暂停的任务在启动恢复时直接结束，等待确认的暂停保留', async t => {
  const { store } = await setup(t)
  await store.create(value('run'))
  await store.update('run', run => {
    run.events.push({ type: 'confirmed' })
    run.steps[0].status = 'paused'
    run.steps.push({ ...run.steps[0], id: 'pending', key: 'generate@pending', status: 'pending' })
    run.pause = { reasons: [{ code: 'review_exhausted', stepId: run.steps[0].id, target: run.steps[0].target, message: '审核未通过，已用尽自动修订次数', actions: ['feedback'] }] }
    return run
  })
  await store.create(value('waiting', 'other-episode'))
  await store.update('waiting', run => {
    run.events.push({ type: 'confirmed' }); run.steps[0].status = 'paused'
    run.pause = { reasons: [{ code: 'wait_confirm', stepId: run.steps[0].id, target: run.steps[0].target, message: '等待确认', actions: ['cancel-branch'] }] }
    return run
  })
  assert.equal((await store.interrupt()).length, 1)
  const run = await store.read('run'), waiting = await store.read('waiting')
  assert.equal(run.status, 'failed'); assert.equal(run.failure.code, 'review_exhausted')
  assert.deepEqual(run.steps.map(step => step.status), ['failed', 'superseded'])
  assert.equal(waiting.status, 'paused')
})
