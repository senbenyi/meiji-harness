import test from 'node:test'
import assert from 'node:assert/strict'
import { createLibraryEntry, addLibraryVariant, mergeLibraryGroup, editLinkedCard, libraryLinks } from '../shared/library-rules.js'
import { cardModel, node, setContent, begin } from '../shared/drama-model.js'
import { setupModel } from './fixtures/model.js'
import { linkedOperationCard } from '../server/data/project-files.js'
import { interruptRunning } from '../server/flow/tasks/task-interrupt.js'

function view(kind) {
  return { episodeId: 'episode', library: { characters: [], scenes: [], props: [] }, plot: { characters: { items: [] }, scenes: { items: [] }, props: { items: [] } } }
}
for (const [kind, id, type] of [['characters', 'C01', 'role'], ['scenes', 'E01', 'scene'], ['props', 'P01', 'prop']]) {
  test(`${kind}：新条目、名字别名复用、模型变体、新变体与无效 ID`, () => {
    let project = view(kind), card = cardModel({ id, type, name: '名称', look: '原描述', description: '道具描述' })
    Object.assign(project, mergeLibraryGroup(project, kind, { ...node(kind), items: [card] }))
    const entry = project.library[kind][0]; entry.aliases = ['别名']
    assert.equal(entry.variants.length, 1); assert.equal(project.plot[kind].items[0].ref.libraryId, entry.id)
    const alias = mergeLibraryGroup(project, kind, { items: [{ ...card, name: '别名', look: '模型新描述' }] })
    assert.equal(alias.library[kind].length, 1); assert.equal(alias.plot[kind].items[0].name, '名称'); assert.equal(alias.plot[kind].items[0][kind === 'props' ? 'description' : 'look'], kind === 'props' ? '道具描述' : '原描述')
    assert.equal(alias.plot[kind].items[0].ref.linkedBy, 'name')
    if (kind === 'characters') {
      assert.throws(() => addLibraryVariant(project, kind, entry.id, { ...card, look: '新变体', variantLabel: '改变状态' }), /不支持多造型/)
      setContent(entry.variants[0].image, { assetId: 'saved', localPath: '/saved.png' }, { passed: true, failures: [] })
      const selected = mergeLibraryGroup(project, kind, { items: [{ ...card, name: '模型姓名', libraryId: entry.id, look: '模型新描述', variantLabel: '旧造型字段' }] })
      assert.equal(selected.library.characters[0].variants.length, 1)
      assert.equal(selected.plot.characters.items[0].ref.variantId, entry.defaultVariantId)
      assert.equal(selected.plot.characters.items[0].name, entry.name)
      assert.equal(selected.plot.characters.items[0].look, '原描述')
      assert.equal(selected.plot.characters.items[0].image.content.assetId, 'saved')
      assert.throws(() => mergeLibraryGroup(project, kind, { items: [{ ...card, libraryId: 'missing' }] }), /库条目不存在/)
      return
    }
    const variant = addLibraryVariant(project, kind, entry.id, { ...card, look: '新变体', variantLabel: '改变状态' })
    const selected = mergeLibraryGroup(project, kind, { items: [{ ...card, libraryId: entry.id, variantId: variant.variant.id }] })
    assert.equal(selected.plot[kind].items[0].ref.variantId, variant.variant.id)
    const added = mergeLibraryGroup(project, kind, { items: [{ ...card, libraryId: entry.id, variantLabel: '另一状态' }] })
    assert.equal(added.library[kind][0].variants.length, 3)
    assert.throws(() => mergeLibraryGroup(project, kind, { items: [{ ...card, libraryId: entry.id, variantId: '错' }] }), /不存在/)
    assert.throws(() => mergeLibraryGroup(project, kind, { items: [{ ...card, variantId: '错' }] }), /必须/)
  })
}

test('关联文字和确认图片同次同步所有剧集；关联锁读取存储数据；仅本集新变体隔离', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => {
    const first = root.episodes[0], second = structuredClone(first); second.id = crypto.randomUUID()
    const p = { ...first, library: root.library, episodeId: first.id }, merged = mergeLibraryGroup(p, 'characters', first.plot.characters)
    root.library = merged.library; first.plot = merged.plot; second.plot = structuredClone(first.plot); root.episodes.push(second)
    return root
  })
  let root = await e.store.read(e.id), first = root.episodes[0], ref = first.plot.characters.items[0].ref
  assert.equal(libraryLinks(root, 'characters', ref.libraryId).length, 2)
  assert.equal(linkedOperationCard(e.home, { projectId: e.id, episodeId: first.id, itemId: 'C01', ref: null }), true)
  await e.store.save(e.id, root => {
    const episode = root.episodes[0], edit = editLinkedCard({ ...episode, library: root.library, episodeId: episode.id }, 'characters', 'C01', { age: '四十岁' })
    root.library = edit.library; episode.plot = edit.plot; return root
  })
  root = await e.store.read(e.id); assert.ok(root.episodes.every(episode => episode.plot.characters.items[0].age === '四十岁'))
  await e.store.save(e.id, root => { setContent(root.episodes[0].plot.characters.items[0].image, { assetId: 'photo', source: 'photo' }, { passed: true, failures: [] }); return root })
  root = await e.store.read(e.id); assert.ok(root.episodes.every(episode => episode.plot.characters.items[0].image.content.assetId === 'photo'))
  assert.equal(root.library.characters[0].variants[0].image.content.assetId, 'photo')
  await e.store.save(e.id, root => {
    const current = root.episodes[0]
    assert.throws(() => editLinkedCard({ ...current, library: root.library, episodeId: current.id }, 'characters', 'C01', { age: '五十岁' }, { newVariant: true }), /不支持多造型/)
    return root
  })
  root = await e.store.read(e.id); assert.equal(root.episodes[0].plot.characters.items[0].age, '四十岁'); assert.equal(root.episodes[1].plot.characters.items[0].age, '四十岁')
})

test('库变体图片重启释放 operation，保留已确认图片', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => {
    const { variant } = createLibraryEntry(root, 'characters', { name: '指定角色' })
    setContent(variant.image, { assetId: 'photo' }, { passed: true, failures: [] }); begin(variant.image, { id: 'interrupted' }); return root
  })
  await interruptRunning(e.store)
  const variant = (await e.store.read(e.id)).library.characters[0].variants[0]
  assert.equal(variant.image.operation, null); assert.equal(variant.image.content.assetId, 'photo'); assert.match(variant.image.error, /重启/)
})


test('库操作创建、关联、删除预览、合并迁移和解除关联使用同一 manager', async t => {
  const { runOperation } = await import('./fixtures/operation.js'), e = await setupModel(t)
  const run = (action, fields = {}) => runOperation(e.op(action, { libraryKind: 'characters', ...fields }), { home: e.home })
  await run('entry-create', { fields: { name: '原角色', aliases: ['别名'], age: '青年' } })
  await run('entry-create', { fields: { name: '目标角色' } })
  let root = await e.store.read(e.id), source = root.library.characters[0], destination = root.library.characters[1]
  await run('card-link', { itemId: 'C01', libraryId: source.id, variantId: source.defaultVariantId })
  const {operationDeletes}=await import('../shared/operation-cascade.js')
  assert.ok(operationDeletes(await e.store.read(e.id),{action:'entry-delete',libraryKind:'characters',libraryId:source.id}).some(item=>item.kind==='character-library'))
  await run('entry-merge', { libraryId: source.id, destinationId: destination.id })
  root = await e.store.read(e.id)
  assert.equal(root.library.characters.length, 1); assert.equal(root.episodes[0].plot.characters.items[0].ref.libraryId, destination.id)
  assert.equal(root.episodes[0].plot.characters.items[0].age, ''); assert.equal(root.library.characters[0].variants.length, 1)
  assert.equal(root.episodes[0].shots.items[0].storyboard.content, null)
  await run('card-unlink', { itemId: 'C01' })
  root = await e.store.read(e.id); assert.equal(root.episodes[0].plot.characters.items[0].ref, undefined)
  await run('entry-delete', { libraryId: destination.id })
  assert.equal((await e.store.read(e.id)).library.characters.length, 0)
})


test('库 AI 图片候选需确认，放弃保留原图，确认写回库与关联卡片', async t => {
  const e = await setupModel(t), { runOperation } = await import('./fixtures/operation.js'), { saveImageDraft } = await import('../server/data/image-storage.js')
  await e.store.save(e.id, root => { const ep = root.episodes[0], merged = mergeLibraryGroup({ ...ep, library: root.library, episodeId: ep.id }, 'characters', ep.plot.characters); root.library = merged.library; ep.plot = merged.plot; return root })
  let root = await e.store.read(e.id), entry = root.library.characters[0], ref = { libraryKind: 'characters', libraryId: entry.id, variantId: entry.defaultVariantId }
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=', 'base64')
  const generate = () => runOperation(e.op('library-image', ref), { home: e.home, submitAssetImage: async input => ({ items: [{ pendingImage: await saveImageDraft(e.home, bytes, 'image/png', 'characters', '候选', { projectId: e.id, itemId: ref.variantId }) }] }) })
  await generate(); root = await e.store.read(e.id)
  let draft = Object.values(root.pendingImages)[0]
  assert.equal(root.library.characters[0].variants[0].image.operation.phase, 'awaiting-confirmation')
  await runOperation(e.op('entry-image-discard', { ...ref, draftId: draft.draftId }), { home: e.home })
  root = await e.store.read(e.id); assert.equal(Object.keys(root.pendingImages).length, 0); assert.equal(root.library.characters[0].variants[0].image.operation, null)
  await generate(); root = await e.store.read(e.id); draft = Object.values(root.pendingImages)[0]
  await runOperation(e.op('entry-image-confirm', { ...ref, draftId: draft.draftId }), { home: e.home })
  root = await e.store.read(e.id); assert.equal(root.library.characters[0].variants[0].image.content.source, 'ai'); assert.equal(root.episodes[0].plot.characters.items[0].image.content.assetId, root.library.characters[0].variants[0].image.content.assetId)
})


test('清除库照片后关联图片均为未生成，不留下审核失败', async t => {
  const e = await setupModel(t), { runOperation } = await import('./fixtures/operation.js')
  await e.store.save(e.id, root => { const ep = root.episodes[0], merged = mergeLibraryGroup({ ...ep, library: root.library, episodeId: ep.id }, 'characters', ep.plot.characters); root.library = merged.library; ep.plot = merged.plot; setContent(root.library.characters[0].variants[0].image, { assetId: 'photo' }, { passed: true, failures: [] }); return root })
  const entry = (await e.store.read(e.id)).library.characters[0]
  await runOperation(e.op('entry-image-clear', { libraryKind: 'characters', libraryId: entry.id, variantId: entry.defaultVariantId }), { home: e.home })
  const root = await e.store.read(e.id)
  assert.equal(root.library.characters[0].variants[0].image.status, 'not-generated')
  assert.equal(root.episodes[0].plot.characters.items[0].image.status, 'not-generated')
})
