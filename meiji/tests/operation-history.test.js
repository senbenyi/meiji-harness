import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass } from './fixtures/review-result.js'
import { outlineFixture } from './fixtures/story-package.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { recordStore, readNodePrompts } from '../server/data/task-store.js'
import { listHistory, readOperation, matchesTarget } from '../server/data/operation-history.js'
import { setWorkspaceRegistry } from '../server/host/harness-workspaces.js'
import { linkStore } from '../server/data/workspace-links.js'
import { runOperation } from './fixtures/operation.js'
import { cardModel } from '../shared/drama-model.js'

test('每秒指令后镜 API 失败只终止后镜，前镜结果与各任务状态独立', async t => {
  const e = await setupModel(t), manager = createOperationManager({ home: e.home })
  const third = structuredClone(e.episode.shots.items[1]); third.id = 'S03'
  await e.store.save(e.id, root => { root.episodes[0].shots.items.push(third); return root })
  let generated = 0
  const started = manager.start(e.op('seconds'), null, { request: async message => {
    if (message.skill === 'review') return reviewPass
    if (++generated === 2) throw new Error('S02 网络失败')
    return secondsForRequest(message)
  } })
  const result = await started.done, saved = await e.read()
  assert.equal(generated, 2)
  assert.deepEqual(result.tasks.map(task => task.status), ['completed', 'failed', 'cancelled'])
  assert.equal(result.status, 'failed'); assert.equal(saved.shots.items[0].seconds.check.passed, true)
  assert.equal(saved.shots.items[0].seconds.content.beats[0].action, '第一镜新动作')
  assert.ok(result.tasks[2].nodes.every(node => node.status === 'cancelled'))
})

test('整集成片视频失败停止后续镜头的分镜与视频任务', async t => {
  const e = await setupModel(t), manager = createOperationManager({ home: e.home }), submitted = []
  const result = await manager.start(e.op('film'), null, {
    submitH3: async ({ items }) => { submitted.push(items[0].track); return { baseUrl: 'https://test', shots: [{ promptId: 'remote', duration: 5 }] } },
    retrieveGatewayVideo: async () => { throw new Error('视频失败') },
  }).done
  assert.deepEqual(submitted, ['S01'])
  assert.deepEqual(result.tasks.map(task => [task.type, task.status]), [['storyboard-prompt', 'completed'], ['video', 'failed'], ['storyboard-prompt', 'cancelled'], ['video', 'cancelled']])
  assert.equal(result.status, 'failed'); assert.equal((await e.read()).shots.items[0].storyboard.check.passed, true)
})

test('三类图片失败只写自身任务与图片节点，不改剧情文字状态', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => { root.episodes[0].plot.props.items = [cardModel({ id: 'P01', name: '铜灯', type: 'prop', description: '铜灯' })]; return root })
  const before = await e.read(), manager = createOperationManager({ home: e.home })
  for (const [action, itemId] of [['character-image', 'C01'], ['scene-image', 'E01'], ['prop-image', 'P01']]) {
    const result = await manager.start(e.op(action, { itemId }), null, { submitAssetImage: async () => { throw new Error('图片失败') } }).done
    assert.equal(result.status, 'failed'); assert.equal(result.tasks.length, 1)
    assert.equal(result.tasks[0].type, action); assert.deepEqual(result.tasks[0].targets, [`image:${itemId}`])
    assert.ok(result.tasks[0].nodes.every(node => !['review', 'revise'].includes(node.kind)))
  }
  const after = await e.read()
  for (const key of ['outline', 'characters', 'scenes', 'props']) assert.equal(after.plot[key].status, before.plot[key].status)
})

test('按 target 精确过滤历史，包含人工编辑；重建管理器后仍能读取完整操作', async t => {
  const e = await setupModel(t), manager = createOperationManager({ home: e.home })
  const generated = manager.start(e.op('seconds'), null, { request: async message => message.skill === 'review' ? reviewPass : secondsForRequest(message) })
  await generated.done
  const restored = await createOperationManager({ home: e.home }).get(generated.id)
  assert.equal(restored.status, 'completed'); assert.equal(restored.tasks.length, 2)
  const single = await listHistory(e.home, e.id, { episodeId: e.episodeId, targets: ['seconds:S01'], tasksOnly: true })
  assert.equal(single.length, 1); assert.deepEqual(single[0].targets, ['seconds:S01'])
  assert.equal(matchesTarget('seconds:S010', 'seconds:S01'), false)
  assert.equal((await listHistory(e.home, e.id, { targets: ['seconds:*'], tasksOnly: true })).length, 2)
  assert.equal((await listHistory(e.home, e.id, { targets: ['seconds:S01'] }))[0].taskIds.length, 2)
  await runOperation(e.op('outline-text', { outline: outlineFixture('新的大纲') }), { home: e.home, reviewContent: async () => ({ passed: true, failures: [] }) })
  const edited = await listHistory(e.home, e.id, { targets: ['outline'], tasksOnly: true })
  assert.equal(edited.length, 1); assert.equal(edited[0].actor, 'human')
  assert.equal((await readOperation(e.home, e.id, edited[0].operationId)).tasks[0].id, edited[0].id)
  const task = single[0], other = restored.tasks.find(item => item.id !== task.id)
  assert.ok((await readNodePrompts(e.home, e.id, task.id, task.nodes[0].id)).length)
  await assert.rejects(readNodePrompts(e.home, e.id, other.id, task.nodes[0].id), { status: 404 })
})

test('剧情文字版本独立，选择图片不生成文字版本', async t => {
  const e = await setupModel(t)
  const revised = outlineFixture('独立修改大纲')
  await runOperation(e.op('outline-text', { outline: revised }), { home: e.home, reviewContent: async () => ({ passed: true, failures: [] }) })
  const before = await e.read(), history = recordStore(e.home, e.id)
  const source = before.plot.outline.source
  assert.ok(source); assert.equal(before.plot.characters.source, undefined)
  const oldCount = (await history.list('artifacts')).filter(item => item.target === 'outline').length
  await e.store.save(e.id, root => { root.episodes[0].plot.characters.items = [structuredClone(e.episode.plot.characters.items[0])]; root.episodes[0].plot.characters.items[0].image.content = { assetId: 'test', assetCategory: 'characters' }; return root })
  const after = await e.read()
  assert.deepEqual(after.plot.outline.source, source)
  assert.equal((await history.list('artifacts')).filter(item => item.target === 'outline').length, oldCount)
  assert.deepEqual(after.plot.outline.content, revised)
})

test('会话绑定校验先于创建操作和任务历史', async t => {
  setWorkspaceRegistry({ list: () => [], get: () => null }); t.after(() => setWorkspaceRegistry(null))
  const e = await setupModel(t), sessionId = 'session-11111111-1111-4111-8111-111111111111'
  const manager = createOperationManager({ home: e.home })
  const denied = manager.start(e.op('seconds', { sessionId, origin: 'session' }))
  await assert.rejects(denied.ready, { status: 409 }); await denied.done
  assert.deepEqual(await recordStore(e.home, e.id).list(), [])
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const accepted = manager.start(e.op('seconds', { sessionId, origin: 'session' }), null, { request: async message => message.skill === 'review' ? reviewPass : secondsForRequest(message) })
  assert.equal((await accepted.done).status, 'completed')
})

 test('空道具集生成通过仍保存本次独立输出快照', async t => {
  const e = await setupModel(t), manager = createOperationManager({ home: e.home })
  const result = await manager.start(e.op('story', { only: 'props' }), null, { request: async message => message.skill === 'review' ? reviewPass : '{"items":[]}' }).done
  assert.equal(result.status, 'completed')
  const task = await recordStore(e.home, e.id).read('tasks', result.tasks[0].id)
  const output = task.latestOutputs.find(item => item.target === 'props')
  assert.ok(output); assert.equal(output.taskId, task.id)
  assert.deepEqual((await recordStore(e.home, e.id).read('artifacts', output.artifactId)).content, [])
  assert.equal((await e.read()).plot.props.source.taskId, task.id)
 })

test('前置项目摘要与剧集草稿状态独立，历史和重启只返回目标剧集草稿', async t => {
  const e = await setupModel(t)
  for (const reviewFails of [false, true]) {
    const project = await e.store.create({ title: '分阶段摘要', mode: 'script', script: '旅人送信后发现旧案。' })
    let generated = 0, reviewed = 0
    const manager = createOperationManager({ home: e.home })
    const started = manager.start({ action: 'summary', projectId: project.id, draft: true, referenceDurationSeconds: 38 }, null, {
      request: async message => {
        if (message.skill === 'review') {
          if (++reviewed === 2 && reviewFails) throw new Error('upstream service error')
          return reviewPass
        }
        return JSON.stringify({ summary: ++generated === 1 ? '项目背景摘要' : '剧集实际剧情摘要' })
      },
    })
    const result = await started.done
    assert.deepEqual(result.tasks.map(task => [task.type, task.status]), [['project-summary', 'completed'], ['summary', reviewFails ? 'failed' : 'completed']])
    assert.equal((await e.store.read(project.id)).summary.status, 'passed')
    assert.equal(result.tasks[0].nodes.find(node => node.kind === 'review').verdict, 'pass')
    for (const restored of [await readOperation(e.home, project.id, started.id), await createOperationManager({ home: e.home }).get(started.id)]) {
      assert.equal(restored.status, reviewFails ? 'failed' : 'completed')
      if (reviewFails) assert.equal(restored.draft, undefined)
      else { assert.equal(restored.draft.summary, '剧集实际剧情摘要'); assert.equal(restored.draft.durationSeconds, 38); assert.equal(restored.draft.check.passed, true) }
    }
  }
})
