import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setupModel } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { useWorkspaces } from './fixtures/host.js'
import { saveIncoming, openIncoming } from '../server/flow/steps/shared/incoming.js'
import { historyStore } from '../server/data/history-store.js'
import { runStore } from '../server/data/run-store.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7T8AAAAASUVORK5CYII=', 'base64')
const image = { data: png.toString('base64'), mime: 'image/png' }
const imageDirectory = e => join(e.home, 'storages/meiji/projects', e.id, 'images', e.episodeId)

test('图片导入经操作入口保存人物和场景文件，消费暂存并保留剧情审核', async t => {
  const e = await setupModel(t)
  await runOperation(e.op('import-image', { itemId: 'C01', ...image }), { home: e.home })
  const incomingId = await saveIncoming(e.home, { name: '场景.png', mime: image.mime, bytes: png })
  const incoming = await openIncoming(e.home, incomingId)
  await runOperation(e.op('import-image', { itemId: 'E01', incomingId }), { home: e.home })
  const p = await e.read()
  for (const [key, id] of [['characters', 'C01'], ['scenes', 'E01']]) {
    assert.deepEqual(await readFile(join(imageDirectory(e), `${id}.png`)), png)
    assert.equal(p.plot[key].check.passed, true)
    assert.equal(p.plot[key].items[0].image.status, 'passed')
    assert.ok(p.plot[key].items[0].image.content.assetId)
  }
  await assert.rejects(stat(incoming.directory), { code: 'ENOENT' })
  // 即时保存只留项目事件，不建立制作任务。
  assert.deepEqual((await historyStore(e.home, e.id).list('events')).map(event => event.type), ['import-image', 'import-image'])
  assert.deepEqual(await runStore(e.home, e.id).list(), [])
  await assert.rejects(runOperation(e.op('import-image', { itemId: 'C99', ...image }), { home: e.home }), /请先写好角色卡或场景卡/)
})

test('人物参考图设置和移除同步文件及项目，拒绝场景参考图', async t => {
  const e = await setupModel(t)
  await runOperation(e.op('set-reference', { itemId: 'C01', ...image }), { home: e.home })
  const file = join(imageDirectory(e), 'C01-ref.png')
  assert.deepEqual(await readFile(file), png)
  assert.match((await e.read()).plot.characters.items[0].reference.localPath, /C01-ref/)
  await runOperation(e.op('clear-reference', { itemId: 'C01' }), { home: e.home })
  assert.equal((await e.read()).plot.characters.items[0].reference, null)
  await assert.rejects(stat(file), { code: 'ENOENT' })
  for (const action of ['set-reference', 'clear-reference']) {
    await assert.rejects(runOperation(e.op(action, { itemId: 'E01', ...image }), { home: e.home }), /只有人物/)
  }
})

test('按标题打开项目绑定专属工作区，拒绝缺失和重名项目', async t => {
  const e = await setupModel(t), rows = {}
  useWorkspaces(t, rows)
  const workspaceController = {
    async create({ path }) {
      const workspaceId = randomUUID()
      rows[workspaceId] = { path, title: workspaceId, sessionIds: [] }
      return { workspace: { workspaceId, ...rows[workspaceId] } }
    },
    async rename({ workspaceId, title }) { rows[workspaceId].title = title },
  }
  const deps = { home: e.home, workspaceController }
  const trace = await runOperation({ action: 'open', title: '测试剧' }, deps)
  assert.ok((await e.store.read(e.id)).workspaceId)
  assert.equal(Object.values(rows)[0].title, '测试剧')
  assert.match(trace.join('\n'), /专属工作区/)
  await assert.rejects(runOperation({ action: 'open', title: '不存在' }, deps), /没有找到/)
  await e.store.create({ mode: 'free', premise: '人的创作方向', title: '测试剧', summary: '同名项目' })
  await assert.rejects(runOperation({ action: 'open', title: '测试剧' }, deps), /同名短剧/)
})

test('修改剧集时长清空本集制作内容，展示摘要不可人工编辑', async t => {
  const e = await setupModel(t), root = await e.store.read(e.id)
  await runOperation(e.op('source', { fields: { summary: '旅人离开庭院', durationSeconds: 12 } }), { home: e.home })
  const p = await e.read()
  assert.equal(p.summary.content, null)
  assert.equal(p.summary.check.passed, null)
  assert.equal(p.durationSeconds, 12)
  assert.equal(p.plot.outline.content, null)
  assert.deepEqual(p.shots.items, [])
  assert.equal((await e.store.read(e.id)).summary.content, root.summary.content)
  await assert.rejects(runOperation(e.op('source', { fields: { durationSeconds: 0 } }), { home: e.home }), /时长/)
  assert.equal((await e.read()).summary.content, null)
})
