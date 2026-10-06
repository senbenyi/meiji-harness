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

test('人物部件支持直接和暂存导入，连续编号且拒绝场景及非法分组', async t => {
  const e = await setupModel(t)
  await runOperation(e.op('part-import', { itemId: 'C01', slot: 'clothes', ...image }), { home: e.home })
  const incomingId = await saveIncoming(e.home, { name: '衣服.png', mime: image.mime, bytes: png })
  await runOperation(e.op('part-import', { itemId: 'C01', slot: 'clothes', incomingId }), { home: e.home })
  const parts = (await e.read()).plot.characters.items[0].clothes
  assert.deepEqual(parts.map(part => part.id), ['C01-W01', 'C01-W02'])
  for (const part of parts) {
    assert.deepEqual(await readFile(join(imageDirectory(e), `${part.id}.png`)), png)
    assert.ok(part.assetId)
  }
  await assert.rejects(runOperation(e.op('part-import', { itemId: 'E01', slot: 'clothes', ...image }), { home: e.home }), /只有人物/)
  await assert.rejects(runOperation(e.op('part-import', { itemId: 'C01', slot: 'unknown', ...image }), { home: e.home }), /不支持的图片分组/)
})

test('图片描述编辑持久化服装并同步 look，拒绝非人物和超长描述', async t => {
  const e = await setupModel(t)
  await runOperation(e.op('part-text', { itemId: 'C01', slot: 'clothes', text: ' 蓝色长衣 ' }), { home: e.home })
  const character = (await e.read()).plot.characters.items[0]
  assert.equal(character.costume, '蓝色长衣')
  assert.match(character.look, /服装：蓝色长衣/)
  await assert.rejects(runOperation(e.op('part-text', { itemId: 'E01', slot: 'clothes', text: '错误' }), { home: e.home }), /只有人物/)
  await assert.rejects(runOperation(e.op('part-text', { itemId: 'C01', slot: 'clothes', text: '长'.repeat(10001) }), { home: e.home }), /不能超过10000字/)
  assert.equal((await e.read()).plot.characters.items[0].costume, '蓝色长衣')
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

test('修改剧集原始摘要清空本集下游而保留项目摘要，非法输入不覆盖', async t => {
  const e = await setupModel(t), root = await e.store.read(e.id)
  await runOperation(e.op('source', { fields: { summary: '旅人离开庭院', durationSeconds: 12 } }), { home: e.home })
  const p = await e.read()
  assert.equal(p.summary.content, '旅人离开庭院')
  assert.equal(p.summary.check.passed, true)
  assert.equal(p.durationSeconds, 12)
  assert.equal(p.plot.outline.content, null)
  assert.deepEqual(p.shots.items, [])
  assert.equal((await e.store.read(e.id)).summary.content, root.summary.content)
  await assert.rejects(runOperation(e.op('source', { fields: { summary: '' } }), { home: e.home }), /本集剧情摘要必须为非空字符串/)
  assert.equal((await e.read()).summary.content, '旅人离开庭院')
})
