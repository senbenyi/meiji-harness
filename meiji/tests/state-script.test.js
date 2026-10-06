import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, tempHome } from './fixtures/model.js'
import { projectStore } from '../server/data/project-store.js'
import { scriptStore } from '../server/data/script-store.js'
import { recordStore } from '../server/data/task-store.js'
import { applyScriptChanges, scriptAppendOnly, scriptBlockers } from '../shared/script-assembly.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { reviewPass } from './fixtures/review-result.js'
import { opProjectDelete } from '../server/flow/operations/direct/operation-project-delete.js'

test('导入为第一版，恢复生成新版本，孤立版本不可见', async t => {
  const home = await tempHome(t), projects = projectStore(home), p = await projects.create({ mode: 'script', title: '导入', script: '最初剧本' }), store = scriptStore(home, projects)
  assert.equal(p.schemaVersion, 3); assert.equal(p.scriptRevision, 1)
  await store.commit(p.id, { script: '新剧本' }, { baseRevision: 1, note: '人工改稿' })
  await store.restore(p.id, 1, '恢复首稿')
  const saved = await projects.read(p.id)
  assert.equal(saved.script, '最初剧本'); assert.equal(saved.scriptRevision, 3)
  const versions = await store.versions(p.id)
  assert.equal(versions[0].restoredFrom, 1)
  await recordStore(home, p.id).update('script-revisions', '4', { revision: 4, content: '未提交版本' })
  assert.equal((await store.versions(p.id)).length, 3)
  await assert.rejects(store.restore(p.id, 4, '无效恢复'), { status: 404 })
})

test('版本文件写入后项目提交失败，原项目和可见历史保持一致', async t => {
  const e = await setupModel(t), original = await e.store.read(e.id)
  const failing = Object.create(e.store)
  failing.save = (id, patch) => e.store.save(id, async p => { await patch(p); throw new Error('模拟提交前中断') })
  await assert.rejects(scriptStore(e.home, failing).commit(e.id, { script: '孤立稿', scriptKind: 'imported' }, { note: '中断' }), /模拟提交前中断/)
  assert.deepEqual(await e.store.read(e.id), original)
  assert.deepEqual(await scriptStore(e.home, e.store).versions(e.id), [])
})

test('目标内唯一匹配，跨小节重复文本不歧义，非法目标或空原文拒绝', () => {
  const project = { scriptKind: 'assembled', script: '相同\n\n相同', episodes: [{ id: 'a' }, { id: 'b' }], scriptSections: { sections: [{ episodeId: 'a', text: '相同' }, { episodeId: 'b', text: '相同' }], future: '' } }
  const next = applyScriptChanges(project, [{ target: { kind: 'episode', episodeId: 'a' }, before: '相同', after: '修改' }])
  assert.equal(next.scriptSections.sections[1].text, '相同')
  assert.equal(project.scriptSections.sections[0].text, '相同')
  assert.throws(() => applyScriptChanges(project, [{ target: { kind: 'episode', episodeId: 'x' }, before: '', after: '新增' }]), /范围/)
  assert.throws(() => applyScriptChanges(project, [{ target: { kind: 'episode', episodeId: 'a' }, before: '', after: '覆盖' }]), /空原文/)
  assert.throws(() => applyScriptChanges({ scriptKind: 'imported', script: '重复重复' }, [{ target: { kind: 'body' }, before: '重复', after: '替换' }]), /唯一/)
})

test('只追加由实际结果判定，改既有小节不能自动写入', () => {
  const p = { scriptKind: 'assembled', scriptSections: { sections: [{ episodeId: 'a', text: '旧小节' }], future: '' }, episodes: [{ id: 'a' }, { id: 'b' }] }
  const next = applyScriptChanges(p, [{ target: { kind: 'episode', episodeId: 'b' }, before: '', after: '新小节' }])
  assert.equal(scriptAppendOnly(p, next, 'b'), true)
  const changed = applyScriptChanges(p, [{ target: { kind: 'episode', episodeId: 'a' }, before: '旧', after: '改' }, { target: { kind: 'episode', episodeId: 'b' }, before: '', after: '新小节' }])
  assert.equal(scriptAppendOnly(p, changed, 'b'), false)
})

test('删集与删除回写事实同次保存，清理历史和重启读取不丢事实', async t => {
  const e = await setupModel(t), before = await e.read()
  await e.store.save(e.id, { episodes: [] })
  await recordStore(e.home, e.id).removeEpisode(e.episodeId)
  const saved = await projectStore(e.home).read(e.id)
  assert.equal(saved.episodes.length, 0)
  assert.equal(saved.scriptPendingDeletes[0].summaryBefore, before.summary.content)
  assert.ok(scriptBlockers(saved).some(item => item.kind === 'episode-delete-sync'))
})

test('删集清理方案引用及历史，剧本页剩余方案可读取且版本与删除事实保留', async t => {
  const e = await setupModel(t), scripts = scriptStore(e.home, e.store), history = recordStore(e.home, e.id)
  await scripts.commit(e.id, { script: '原文', scriptKind: 'imported' }, { note: '初稿' })
  const proposal = { source: 'episode-sync', baseRevision: 1, episodeId: e.episodeId, summaryRevision: e.episode.summary.revision, note: '本集方案', changes: [{ target: { kind: 'body' }, before: '原文', after: '新文' }] }
  const removed = await scripts.propose(e.id, proposal)
  const retained = await scripts.propose(e.id, { ...proposal, source: 'edit', episodeId: null, note: '项目方案' })
  const versions = await scripts.versions(e.id)
  await opProjectDelete({ home: e.home, project: await e.store.read(e.id), rootProjects: e.store,
    operation: e.op('episode-delete'), trace: {}, note() {} })
  const saved = await projectStore(e.home).read(e.id)
  assert.deepEqual(saved.scriptProposals.map(p => p.id), [retained])
  await assert.rejects(history.read('artifacts', removed), { code: 'ENOENT' })
  assert.equal((await Promise.all(saved.scriptProposals.map(p => history.read('artifacts', p.id))))[0].content.id, retained)
  assert.deepEqual(await scripts.versions(e.id), versions)
  assert.equal(saved.scriptPendingDeletes[0].episodeId, e.episodeId)
  assert.ok(scriptBlockers(saved).some(x => x.kind === 'episode-delete-sync'))
})

test('方案生成、部分确认与放弃保留待回写，旧摘要拒绝确认', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, p => { delete p.episodes[0].summary.basis.scriptSyncedRevision; return p })
  const p = await e.store.read(e.id), scripts = scriptStore(e.home, e.store)
  await scripts.commit(e.id, { script: '原文剧情', scriptKind: 'imported' }, { note: '初稿' })
  const proposal = { source: 'episode-sync', baseRevision: 1, episodeId: e.episodeId, summaryRevision: p.episodes[0].summary.revision, note: '回写', changes: [{ target: { kind: 'body' }, before: '原文', after: '新文' }, { target: { kind: 'body' }, before: '剧情', after: '故事' }] }
  const id = await scripts.propose(e.id, proposal)
  assert.ok(scriptBlockers(await e.store.read(e.id)).some(item => item.kind === 'episode-sync'))
  await scripts.resolve(e.id, id, [0])
  assert.equal((await e.store.read(e.id)).script, '新文剧情')
  assert.ok(scriptBlockers(await e.store.read(e.id)).some(item => item.kind === 'episode-sync'))
  const discardId = await scripts.propose(e.id, { ...proposal, baseRevision: 2 })
  await scripts.resolve(e.id, discardId, [])
  assert.ok(scriptBlockers(await e.store.read(e.id)).some(item => item.kind === 'episode-sync'))
  const stale = await scripts.propose(e.id, { ...proposal, baseRevision: 2 })
  await e.store.save(e.id, current => { current.episodes[0].summary.revision++; return current })
  await assert.rejects(scripts.resolve(e.id, stale, [0]), { status: 409 })
})

test('父保存释放后仅启动一次独立回写，只追加建立首版', async t => {
  const e = await setupModel(t), manager = createOperationManager({ home: e.home })
  let generates = 0
  const request = async message => {
    if (message.skill === 'review') return reviewPass
    generates++
    return JSON.stringify({ needsChange: true, note: '新增本集', changes: [{ target: { kind: 'episode', episodeId: e.episodeId }, before: '', after: '本集新剧情' }], appendOnly: false })
  }
  const parent = manager.start({ action: 'episode-edit', projectId: e.id, episodeId: e.episodeId, fields: { durationSeconds: 10, summary: '本集新摘要' } }, null, { request })
  const result = await parent.done
  assert.equal(result.status, 'completed')
  assert.ok(result.result.scriptSyncOperationId)
  assert.equal(manager.list(e.id).some(op => op.id === parent.id), false)
  const child = result.result.scriptSyncOperationId
  let final
  do { final = await manager.whenEnded(child) } while (['queued', 'running'].includes(final.status))
  assert.equal(final.status, 'completed')
  assert.equal(generates, 1)
  const project = await e.store.read(e.id)
  assert.equal(project.scriptRevision, 1)
  assert.equal(project.script, '本集新剧情')
  assert.equal(project.episodes[0].summary.basis.scriptSyncedRevision, project.episodes[0].summary.revision)
  assert.deepEqual(scriptBlockers(project), [])
})

test('无需修改不产生版本，全部确认才解除回写', async t => {
  const e = await setupModel(t), scripts = scriptStore(e.home, e.store)
  await scripts.commit(e.id, { script: '原剧情', scriptKind: 'imported' }, { note: '首稿' })
  const root = await e.store.read(e.id), revision = root.episodes[0].summary.revision
  await e.store.save(e.id, p => { delete p.episodes[0].summary.basis.scriptSyncedRevision; return p })
  const manager = createOperationManager({ home: e.home })
  const started = manager.start({ action: 'script-sync', projectId: e.id, episodeId: e.episodeId }, null, { request: async message => message.skill === 'review' ? reviewPass : JSON.stringify({ needsChange: false, note: '无需修改', changes: [] }) })
  assert.equal((await started.done).status, 'completed')
  assert.equal((await e.store.read(e.id)).scriptRevision, 1)
  assert.deepEqual(scriptBlockers(await e.store.read(e.id)), [])
  await e.store.save(e.id, p => { delete p.episodes[0].summary.basis.scriptSyncedRevision; return p })
  const proposal = await scripts.propose(e.id, { source: 'episode-sync', baseRevision: 1, episodeId: e.episodeId, summaryRevision: revision, note: '修改', changes: [{ target: { kind: 'body' }, before: '原', after: '新' }] })
  await scripts.resolve(e.id, proposal, [0])
  assert.deepEqual(scriptBlockers(await e.store.read(e.id)), [])
})

test('自动回写启动遇忙不回退摘要，保留依据后可手动重试', async t => {
  const e = await setupModel(t), manager = createOperationManager({ home: e.home }), start = manager.start
  manager.start = function (op, ...args) {
    if (op.action === 'script-sync') throw Object.assign(new Error('模拟启动遇忙'), { status: 409, code: 'TARGET_BUSY' })
    return start.call(this, op, ...args)
  }
  const result = await manager.start(e.op('episode-edit', { fields: { summary: '保存成功', durationSeconds: 10 } })).done
  assert.equal(result.status, 'completed'); assert.match(result.result.scriptSyncError, /启动遇忙/)
  assert.equal((await e.read()).summary.content, '保存成功')
  assert.ok(scriptBlockers(await e.store.read(e.id)).length)
  manager.start = start
  const retry = await manager.start(e.op('script-sync'), null, { request: async message => message.skill === 'review' ? reviewPass : JSON.stringify({ needsChange: true, note: '只追加', changes: [{ target: { kind: 'episode', episodeId: e.episodeId }, before: '', after: '保存成功' }] }) }).done
  assert.equal(retry.status, 'completed'); assert.deepEqual(scriptBlockers(await e.store.read(e.id)), [])
})

test('删除回写失败、停止及重启读取都保留删除事实，完成后清除', async t => {
  const e = await setupModel(t), scripts = scriptStore(e.home, e.store)
  await scripts.commit(e.id, { script: '旧剧情', scriptKind: 'imported' }, { note: '导入' })
  await e.store.save(e.id, { episodes: [] })
  const manager = createOperationManager({ home: e.home })
  const failed = await manager.start(e.op('script-sync'), null, { request: async () => { throw new Error('模拟断网') } }).done
  assert.equal(failed.status, 'failed'); assert.equal((await e.store.read(e.id)).scriptPendingDeletes.length, 1)
  const ready = Promise.withResolvers()
  const cancelled = manager.start(e.op('script-sync'), null, { request: ({ signal }) => { ready.resolve(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) } })
  await ready.promise; manager.cancel(cancelled.id, e.id); assert.equal((await cancelled.done).status, 'cancelled')
  assert.equal((await projectStore(e.home).read(e.id)).scriptPendingDeletes.length, 1)
  await manager.start(e.op('script-sync'), null, { request: async message => message.skill === 'review' ? reviewPass : '{"needsChange":false,"note":"无需修改","changes":[]}' }).done
  assert.equal((await e.store.read(e.id)).scriptPendingDeletes.length, 0)
})

test('新回写方案替换同集旧方案；旧剧本版本、旧摘要都不能写入', async t => {
  const e = await setupModel(t), scripts = scriptStore(e.home, e.store)
  await scripts.commit(e.id, { script: '旧内容', scriptKind: 'imported' }, { note: '首版' })
  const p = await e.store.read(e.id), proposal = { source: 'episode-sync', baseRevision: 1, episodeId: e.episodeId, summaryRevision: p.episodes[0].summary.revision, note: '修改', changes: [{ target: { kind: 'body' }, before: '旧', after: '新' }] }
  const old = await scripts.propose(e.id, proposal), current = await scripts.propose(e.id, proposal)
  assert.equal((await e.store.read(e.id)).scriptProposals.find(item => item.id === old).status, 'superseded')
  await assert.rejects(scripts.resolve(e.id, old, [0]), { status: 409 })
  await scripts.commit(e.id, { script: '另一个版本' }, { baseRevision: 1, note: '人工编辑' })
  await assert.rejects(scripts.resolve(e.id, current, [0]), { status: 409 })
})

test('剧本阻断只拦剧情层，同集摘要修复和下游操作仍能规划', async t => {
  const { planTasks } = await import('../server/flow/operations/operation-registry.js')
  const e = await setupModel(t)
  await e.store.save(e.id, root => { delete root.episodes[0].summary.basis.scriptSyncedRevision; return root })
  for (const action of ['story', 'episode-add', 'script-revise', 'project-summary']) await assert.rejects(planTasks(e.home, e.op(action, { requirements: '修复', fields: { summary: '新集', durationSeconds: 10 } })), { code: 'SCRIPT_PENDING' })
  assert.ok((await planTasks(e.home, e.op('summary'))).length)
  assert.ok((await planTasks(e.home, e.op('shot-table'))).length)
  assert.ok((await planTasks(e.home, e.op('episode-edit'))).length)
})

test('项目摘要前置失败停止原生成，重试成功后继续，意见进入提示词', async t => {
  const e = await setupModel(t), scripts = scriptStore(e.home, e.store)
  await scripts.commit(e.id, { script: '导入剧本', scriptKind: 'imported' }, { note: '首版' })
  const manager = createOperationManager({ home: e.home }); let calls = 0
  const failed = await manager.start(e.op('summary'), null, { request: async () => { calls++; throw new Error('摘要更新失败') } }).done
  assert.equal(failed.status, 'failed'); assert.equal(calls, 1); assert.equal(failed.tasks[1].status, 'cancelled')
  const request = async message => message.skill === 'review' ? reviewPass : JSON.stringify({ summary: message.skill === 'project-summary' ? '全剧摘要' : '旅人进入庭院' })
  const success = await manager.start(e.op('summary'), null, { request }).done
  assert.equal(success.status, 'completed'); assert.equal((await e.store.read(e.id)).summary.basis.scriptRevision, 1)
  if (success.result.scriptSyncOperationId) await manager.whenEnded(success.result.scriptSyncOperationId)
  const { buildTextPrompts } = await import('../server/prompts/text-prompts.js')
  assert.match(buildTextPrompts({ skill: 'project-summary', project: await e.store.read(e.id), opinion: '补结局' }).generation.user, /补结局/)
})


test('第二集没有剧本小节时，错误无需修改进入修订，新小节保存后才完成回写', async t => {
  const e = await setupModel(t), firstId = e.episodeId
  const { scriptStore } = await import('../server/data/script-store.js'), { runOperation } = await import('./fixtures/operation.js')
  const { reviewPass } = await import('./fixtures/review-result.js')
  await scriptStore(e.home, e.store).commit(e.id, { scriptKind: 'assembled', scriptSections: { sections: [{ episodeId: firstId, text: '第一集到家' }], future: '' }, script: '第一集到家' }, { source: 'edit', note: '已发生第一集' })
  const secondId = crypto.randomUUID()
  await e.store.save(e.id, root => { const second = structuredClone(root.episodes[0]); second.id = secondId; second.summary.content = '第二集去渡口'; second.summary.revision++; root.episodes.unshift(second); return root })
  let generated = 0
  const manager = createOperationManager({ home: e.home })
  const started = manager.start(e.op('script-sync', { episodeId: secondId }), null, { request: async message => {
    if (message.skill === 'review') return reviewPass
    generated++; assert.match(message.user, new RegExp(secondId)); assert.match(message.user, /第二集去渡口/)
    return JSON.stringify(generated === 1 ? { needsChange: false, note: '错误无需修改', changes: [] } : { needsChange: true, note: '新增第二集', changes: [{ target: { kind: 'episode', episodeId: secondId }, before: '', after: '第二集去渡口' }] })
  } })
  assert.equal((await started.done).status, 'completed')
  const root = await e.store.read(e.id), second = root.episodes.find(item => item.id === secondId)
  assert.equal(generated, 2); assert.equal(root.scriptRevision, 2)
  assert.equal(root.scriptSections.sections.find(item => item.episodeId === secondId).text, '第二集去渡口')
  assert.equal(second.summary.basis.scriptSyncedRevision, second.summary.revision)
})
