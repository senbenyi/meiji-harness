import { operationRequest } from '../client/operation-request.js'
// 状态稳定性基线（计划-操作任务节点三层模型 第 17、18 节，阶段 A0）。
// 用 todo 记录尚未修复的现有缺陷：失败不计入总失败数；对应阶段修复后去掉 todo，改为普通测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { runOperation } from './fixtures/operation.js'
import { setupModel, tempHome } from './fixtures/model.js'
import { outlineFixture } from './fixtures/story-package.js'
import { randomUUID } from 'node:crypto'
import { linkStore } from '../server/data/workspace-links.js'
import { contentGenerateTool } from '../tools/session-content-generate-tool.js'
import { taskControlTool } from '../tools/session-task-control-tool.js'

const blocking = async (_operation, deps) => new Promise((_, reject) => deps.signal.addEventListener('abort', () => reject(deps.signal.reason), { once: true }))
async function stopAll(tasks, projectId, started) {
  for (const task of tasks.list(projectId)) tasks.cancel(task.id, projectId)
  await Promise.allSettled(started.map(task => task.done))
}

test('B1 同一集同一时间只允许一个生成操作，不同镜头也不能同时进行', async t => {
  const tasks = createOperationManager({ home: await tempHome(t), execute: blocking }), started = []
  started.push(tasks.start({ projectId: 'p', episodeId: 'e', action: 'film', track: 'S01' }))
  try {
    assert.throws(() => started.push(tasks.start(operationRequest('shot-storyboard', { projectId: 'p', episodeId: 'e', track: 'S02' }))), { status: 409 })
  } finally { await stopAll(tasks, 'p', started) }
})

test('B3 本集生成操作占用期间，面板直接编辑同一集被拒绝（只有一把锁）', async t => {
  const e = await setupModel(t)
  const tasks = createOperationManager({ home: e.home, execute: blocking }), started = [tasks.start(e.op('story', {}))]
  try {
    await assert.rejects(runOperation(e.op('outline-text', { outline: outlineFixture('面板改写的大纲') }), { home: e.home, reviewContent: async () => ({ passed: true, failures: [] }) }), { status: 409 })
  } finally { await stopAll(tasks, e.id, started) }
})

test('AC-M2 面板占用本集时，会话发起返回 busy；会话可等待但不能停止该操作，结束后重新发起成功', async t => {
  const e = await setupModel(t)
  const exec = { agent: { session: { id: 'session-' + randomUUID(), append() {} } }, signal: new AbortController().signal }
  await linkStore(e.home).selectProject(exec.agent.session.id, e.id, e.store)
  let releasePanel
  const gate = new Promise(resolve => { releasePanel = resolve })
  const tasks = createOperationManager({ home: e.home, execute: async operation => { if (operation.origin === 'panel') await gate; return ['完成'] } })
  const panel = tasks.start({ ...e.op('shot-table', {}), origin: 'panel' })
  const generate = contentGenerateTool({ home: e.home, tasks }), control = taskControlTool({ home: e.home, tasks })
  const busy = JSON.parse(await generate.execute({ stage: 'shots', episodeNumber: 1, mode: 'regenerate' }, exec))
  assert.equal(busy.status, 'busy'); assert.equal(busy.operationId, panel.id); assert.equal(busy.initiator, 'panel')
  assert.match(busy.message, /本集正在执行：生成镜头表.*（面板发起）/)
  await assert.rejects(control.execute({ action: 'cancel', operationId: busy.operationId }, exec), { status: 404 })
  setTimeout(releasePanel, 30)
  const waited = JSON.parse(await control.execute({ action: 'wait', operationId: busy.operationId }, exec))
  assert.equal(waited.status, 'completed'); assert.equal(waited.occupant, true); assert.equal(waited.nodes, undefined)
  const again = JSON.parse(await generate.execute({ stage: 'shots', episodeNumber: 1, mode: 'regenerate' }, exec))
  assert.equal(again.status, 'running')
  assert.equal(JSON.parse(await control.execute({ action: 'wait', operationId: again.operationId }, exec)).status, 'completed')
})

test('AC-M4 占用在操作结束或停止后释放；另一集不受影响', async t => {
  const tasks = createOperationManager({ home: await tempHome(t), execute: blocking }), started = []
  const first = tasks.start(operationRequest('shots', { projectId: 'p', episodeId: 'e1' })); started.push(first)
  started.push(tasks.start(operationRequest('shots', { projectId: 'p', episodeId: 'e2' })))
  assert.throws(() => tasks.start({ projectId: 'p', episodeId: 'e1', action: 'seconds' }), error => error.status === 409 && error.busy.operationId === first.id)
  tasks.cancel(first.id, 'p'); await first.done
  const next = tasks.start({ projectId: 'p', episodeId: 'e1', action: 'seconds' }); started.push(next)
  await stopAll(tasks, 'p', started)
})

test('B2 操作失败只记录在任务与内容节点上，不写剧集级 activityError', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('shot-table', {}), { home: e.home, generateShots: async () => { throw new Error('镜头表生成失败') } }), /镜头表生成失败/)
  const episode = await e.read(), root = await e.store.read(e.id)
  assert.equal(episode.shots.error, '镜头表生成失败')
  assert.equal(episode.activityError ?? null, null)
  assert.equal(root.activityError ?? null, null)
})

const root = fileURLToPath(new URL('..', import.meta.url))
function serverFiles(dir = 'server') {
  return readdirSync(join(root, dir)).flatMap(name => {
    const path = `${dir}/${name}`
    return statSync(join(root, path)).isDirectory() ? serverFiles(path) : path.endsWith('.js') ? [path] : []
  })
}
test('B4 服务端不直接修改内容节点状态，只经 shared/content-state.js 转换', () => {
  // 任意 `.status =` 赋值（步骤状态 StepStatus 除外）或对象字面量 `status: GenerationStatus.` 都视为直接修改。
  const offenders = serverFiles().flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, index) => ({ file, line, index }))
    .filter(({ line }) => (/\.status\s*=(?!=)/.test(line) && !/StepStatus/.test(line)) || /\bstatus:\s*GenerationStatus\./.test(line))
    .map(({ file, index }) => `${relative('.', file)}:${index + 1}`))
  assert.deepEqual(offenders, [])
})
