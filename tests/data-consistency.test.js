import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectStore, revisionStore } from '../server/data/projects.js'
import { addEpisode, materialize, scopeProjects } from '../server/data/episodes.js'
import { replaceFrom, staleMedia } from '../server/flow/gates.js'
import { runOperation, stageOperation, takeOperation, takePendingForSession } from '../server/flow/actions.js'
import { submitAssetImage, imageAssets, clearCharacterImage } from '../server/generate/image.js'
import { savePicture, readPicture, saveImageDraft, readImageDraft } from '../server/data/pictures.js'
import { assetStore } from '../server/data/library.js'
import { shotReferenceImages } from '../server/generate/film.js'

async function fixture(fn) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-data-'))
  const store = projectStore(home)
  try {
    const project = await store.create({ title: '测试短剧', summary: '故事摘要', style: '写实' })
    await fn({ home, store, project })
  } finally { await rm(home, { recursive: true, force: true }) }
}
const person = { id: 'C01', type: 'role', name: '主角', look: '三十岁中国男子，短黑发，身材高大，五官轮廓分明' }

test('parallel updates through separate store instances preserve fields and valid JSON', () => fixture(async ({ home, store, project }) => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => projectStore(home).save(project.id, { ['field' + i]: i })))
  const final = await store.read(project.id)
  for (let i = 0; i < 20; i++) assert.equal(final['field' + i], i)
  assert.equal(final.revision, 20)
  assert.equal(JSON.parse(await readFile(join(home, 'storages/meiji/projects', project.id + '.json'), 'utf8')).revision, 20)
}))

test('concurrent episode writes merge inside the project lock and keep project style', () => fixture(async ({ store, project }) => {
  await store.save(project.id, current => addEpisode(current, { summary: '第一集', durationSeconds: 60 }))
  const current = await store.save(project.id, value => addEpisode(value, { summary: '第二集', durationSeconds: 60 }))
  const [a, b] = current.episodes
  await Promise.all([
    scopeProjects(store, a.id).save(project.id, { outline: '大纲 A' }),
    scopeProjects(store, b.id).save(project.id, { outline: '大纲 B' }),
  ])
  const final = await store.read(project.id)
  assert.equal(materialize(final, a.id).outline, '大纲 A')
  assert.equal(materialize(final, b.id).outline, '大纲 B')
  assert.equal(materialize(final, a.id).style, '写实')
}))

test('stale generation cannot overwrite an intervening edit', () => fixture(async ({ store, project }) => {
  const job = revisionStore(store)
  await job.read(project.id)
  await store.save(project.id, { summary: '用户的新摘要' })
  await assert.rejects(() => job.save(project.id, { summary: '旧生成结果' }), { status: 409 })
  assert.equal((await store.read(project.id)).summary, '用户的新摘要')
}))

test('generated images remain separate previews and never enter the library before confirmation', () => fixture(async ({ home, project }) => {
  const input = { assets: { items: [person] }, itemId: person.id, projectId: project.id, episodeId: 'episode-a', home,
    directory: join(home, 'cache'), backend: { baseUrl: 'http://example.test/v1', apiKey: 'test', model: 'image' },
    prompt: person.look, fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from([137, 80, 78, 71]).toString('base64') }] })) }
  const a = (await submitAssetImage(input)).items[0]
  const b = (await submitAssetImage({ ...input, assets: { items: [a] } })).items[0]
  assert.equal(a.assetId, undefined)
  assert.equal(a.imageUrl, null)
  assert.notEqual(a.pendingImage.draftId, b.pendingImage.draftId)
  assert.equal((await assetStore(home).list('characters')).length, 0)
  assert.deepEqual((await readImageDraft(home, a.pendingImage.draftId)).bytes, Buffer.from([137, 80, 78, 71]))
  await assert.rejects(readFile(join(home, 'cache', 'C01.png')), { code: 'ENOENT' })
}))

test('one asset can be bound to multiple projects; detach affects only the chosen reference', () => fixture(async ({ home, store, project }) => {
  const reference = await savePicture(home, Buffer.from('image'), 'image/png', 'characters', '主角')
  const other = await store.create({ title: '另一个短剧', summary: '另一个故事' })
  for (const p of [project, other]) {
    const saved = await store.save(p.id, current => addEpisode(current, { summary: '剧情', durationSeconds: 60 }))
    const ep = saved.episodes[0].id
    await scopeProjects(store, ep).save(p.id, { characters: { items: [person] } })
    await runOperation({ action: 'use-asset', projectId: p.id, episodeId: ep, itemId: 'C01', category: 'characters', assetId: reference.assetId }, { home })
  }
  const a = await store.read(project.id), b = await store.read(other.id)
  assert.equal(a.episodes[0].characters.items[0].assetId, b.episodes[0].characters.items[0].assetId)
  const refs = shotReferenceImages(materialize(b, b.episodes[0].id), { characters: ['主角'] })
  assert.equal(refs[0].assetId, reference.assetId)
  await runOperation({ action: 'clear-image', projectId: project.id, episodeId: a.episodes[0].id, itemId: 'C01' }, { home })
  assert.equal((await store.read(other.id)).episodes[0].characters.items[0].assetId, reference.assetId)
  assert.ok((await assetStore(home).file('characters', reference.assetId)).path)
  assert.equal(imageAssets([{ id: 'C01-W01', name: '衣服', ...reference }])[0].assetId, reference.assetId)
}))

test('multi-episode production refuses a missing episode instead of changing root data', () => fixture(async ({ home, store, project }) => {
  await store.save(project.id, current => addEpisode(current, { summary: '第一集', durationSeconds: 60 }))
  await store.save(project.id, current => addEpisode(current, { summary: '第二集', durationSeconds: 60 }))
  const before = await store.read(project.id)
  await assert.rejects(() => runOperation({ action: 'outline-text', projectId: project.id, outline: '错误大纲' }, { home }), /episodeId/)
  assert.deepEqual(await store.read(project.id), before)
}))

test('operation IDs preserve click order and reject cross-session or repeated claims', () => {
  const a = stageOperation({ action: 'shots', sessionId: 'a', projectId: 'p' })
  const b = stageOperation({ action: 'scenes', sessionId: 'a', projectId: 'p' })
  assert.throws(() => takePendingForSession('a'), /operationId/)
  assert.throws(() => takeOperation(a, 'b'), { status: 403 })
  assert.equal(takeOperation(a, 'a').action, 'shots')
  assert.equal(takeOperation(b, 'a').action, 'scenes')
  assert.throws(() => takeOperation(a, 'a'), { status: 404 })
})

test('upstream changes invalidate assembly and preserve referenced old videos as stale', () => {
  const project = { films: { S01: { status: 'ready', assetIds: ['asset-a'], url: '/old.mp4' } }, assembly: { status: 'ready', url: '/assembly.mp4' } }
  assert.equal(replaceFrom(project, 'outline', { outline: '新大纲' }).assembly, null)
  const stale = staleMedia(project)
  assert.equal(stale.assembly.status, 'stale')
  assert.equal(stale.films.S01.status, 'stale')
  assert.deepEqual(stale.films.S01.assetIds, ['asset-a'])
})

test('a detached generation holds the project lock and releases only its own activity after a conflict', () => fixture(async ({ home, store, project }) => {
  await store.save(project.id, { characters: { items: [person] } })
  let complete
  await runOperation({ action: 'image', projectId: project.id, itemId: person.id }, {
    home, submitAssetImage: () => new Promise(resolve => { complete = resolve }),
  })
  await assert.rejects(() => runOperation({ action: 'outline-text', projectId: project.id, outline: '不应执行' }, { home }), /还在进行/)
  await store.save(project.id, { characters: { items: [{ ...person, name: '用户的新名字' }] } })
  complete({ items: [{ ...person, name: '旧结果' }] })
  let final
  for (let i = 0; i < 100; i++) {
    final = await store.read(project.id)
    if (!final.activity) break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(final.characters.items[0].name, '用户的新名字')
  assert.equal(final.activity, null)
  assert.match(final.activityError, /未覆盖/)
  assert.equal(final.activeOperation, null)
}))

test('failed review regeneration retains feedback in the owning episode', async () => fixture(async ({ home, store, project }) => {
  const added = await store.save(project.id, addEpisode(project, { summary: '第一集', durationSeconds: 6 }))
  const episodeId = added.episodes[0].id
  const scoped = scopeProjects(store, episodeId)
  await scoped.save(project.id, { shots: { items: [{ id: 'S01', duration: 6 }] } })
  const review = '动作需要连贯，不要突然转身'
  await assert.rejects(runOperation({ action: 'shot-seconds', projectId: project.id, episodeId, track: 'S01', review }, {
    home, generateShotSeconds: async input => {
      assert.equal(input.review, review)
      throw new Error('模拟模型失败')
    },
  }), /模拟模型失败/)
  const saved = await store.read(project.id)
  assert.equal(saved.episodes[0].feedback['seconds:S01'].review.history.at(-1).text, review)
  assert.equal(saved.episodes[0].feedback['seconds:S01'].review.text, review)
  assert.equal(saved.reviewHistory, undefined)
  assert.equal(saved.activity, null)
  assert.match(saved.episodes[0].activityError, /模拟模型失败/)
}))

test('rejected shot tables cannot proceed to batch storyboard generation', async () => fixture(async ({ home, store, project }) => {
  await store.save(project.id, { shots: { items: [{ id: 'S01' }], check: { passed: false, failures: ['开场缺少悬念'] } } })
  for (const action of ['storyboard', 'shot-boards']) {
    await assert.rejects(runOperation({ action, projectId: project.id, track: 'S01' }, { home }), /开场缺少悬念/)
  }
  assert.equal((await store.read(project.id)).activity, undefined)
}))

async function pendingFixture(fn) {
  return fixture(async ({ home, store, project }) => {
    const created = await store.save(project.id, p => addEpisode(p, { summary: '剧情', durationSeconds: 60 }))
    const episodeId = created.episodes[0].id
    const scoped = scopeProjects(store, episodeId)
    await scoped.save(project.id, { characters: { items: [person] } })
    const current = await scoped.read(project.id)
    const draft = await saveImageDraft(home, Buffer.from('preview-image'), 'image/png', 'characters', '主角', { source: 'generated', projectId: project.id, episodeId, itemId: 'C01' })
    await scoped.save(project.id, { pendingImages: { [draft.draftId]: { ...draft, key: 'characters', itemId: 'C01', name: '主角', target: JSON.stringify(current.characters.items[0]) } } })
    const operation = { action: 'confirm-image', projectId: project.id, episodeId, draftId: draft.draftId }
    await fn({ home, store, scoped, project, operation, draft })
  })
}

test('confirmation uploads before publishing an asset and stores imageUrl in the episode and library', () => pendingFixture(async ({ home, scoped, project, operation, draft }) => {
  let calls = 0
  const deps = { home, imageReviewAllowed: true, uploadGatewayFile: async ({ bytes }) => {
    calls++
    assert.equal((await assetStore(home).list('characters')).length, 0)
    assert.equal((await scoped.read(project.id)).characters.items[0].assetId, undefined)
    assert.equal(bytes.toString(), 'preview-image')
    return { id: 'remote', url: 'https://example.test/confirmed.png' }
  } }
  await runOperation(operation, deps)
  const saved = await scoped.read(project.id)
  assert.equal(saved.feedback['image:C01'].review.status, 'approved')
  const item = saved.characters.items[0]
  assert.equal(item.imageUrl, 'https://example.test/confirmed.png')
  assert.equal((await assetStore(home).file('characters', item.assetId)).metadata.imageUrl, item.imageUrl)
  assert.deepEqual(saved.pendingImages, {})
  assert.equal(saved.activity, null)
  await assert.rejects(readImageDraft(home, draft.draftId), { code: 'ENOENT' })
  await assert.rejects(runOperation(operation, deps), { status: 409 })
  assert.equal(calls, 1)
}))

test('upload failure preserves the preview and leaves the library and active picture untouched', () => pendingFixture(async ({ home, scoped, project, operation, draft }) => {
  await assert.rejects(runOperation(operation, { home, imageReviewAllowed: true, uploadGatewayFile: async () => { throw new Error('上传失败') } }), /上传失败/)
  const saved = await scoped.read(project.id)
  assert.ok(saved.pendingImages[draft.draftId])
  assert.equal(saved.characters.items[0].assetId, undefined)
  assert.equal(saved.activity, null)
  assert.equal((await assetStore(home).list('characters')).length, 0)
  assert.equal((await readImageDraft(home, draft.draftId)).bytes.toString(), 'preview-image')
}))

test('model operations cannot approve previews and stale targets cannot be approved', () => pendingFixture(async ({ home, scoped, project, operation }) => {
  await assert.rejects(runOperation(operation, { home }), { status: 403 })
  await scoped.save(project.id, { characters: { items: [{ ...person, name: '已修改' }] } })
  await assert.rejects(runOperation(operation, { home, imageReviewAllowed: true }), /对应内容已修改/)
  assert.equal((await assetStore(home).list('characters')).length, 0)
}))

test('discard removes only the pending image', () => pendingFixture(async ({ home, scoped, project, operation, draft }) => {
  await runOperation({ ...operation, action: 'discard-image' }, { home, imageReviewAllowed: true })
  assert.deepEqual((await scoped.read(project.id)).pendingImages, {})
  await assert.rejects(readImageDraft(home, draft.draftId), { code: 'ENOENT' })
  assert.equal((await assetStore(home).list('characters')).length, 0)
}))

test('an edit during upload prevents stale binding and removes the unbound library asset', () => pendingFixture(async ({ home, store, scoped, project, operation, draft }) => {
  await assert.rejects(runOperation(operation, { home, imageReviewAllowed: true, uploadGatewayFile: async () => {
    await store.save(project.id, { title: '上传期间修改' })
    return { url: 'https://example.test/confirmed.png' }
  } }), { status: 409 })
  const saved = await scoped.read(project.id)
  assert.equal(saved.characters.items[0].assetId, undefined)
  assert.ok(saved.pendingImages[draft.draftId])
  assert.equal((await assetStore(home).list('characters')).length, 0)
}))

test('a draft from another episode cannot be uploaded or bound', () => pendingFixture(async ({ home, scoped, project, operation, draft }) => {
  const other = await saveImageDraft(home, Buffer.from('other'), 'image/png', 'characters', '其他集', { source: 'generated', projectId: project.id, episodeId: 'another-episode' })
  const current = await scoped.read(project.id)
  await scoped.save(project.id, { pendingImages: { [other.draftId]: { ...current.pendingImages[draft.draftId], ...other } } })
  await assert.rejects(runOperation({ ...operation, draftId: other.draftId }, { home, imageReviewAllowed: true }), /不属于当前剧集/)
  assert.equal((await assetStore(home).list('characters')).length, 0)
}))

for (const kind of ['part', 'board']) test(`${kind} confirmation binds the uploaded asset only after approval`, () => pendingFixture(async ({ home, scoped, project, operation, draft }) => {
  const current = await scoped.read(project.id)
  const pending = current.pendingImages[draft.draftId]
  if (kind === 'part') pending.slot = 'props'
  else {
    const shot = { id: 'S01', panels: [{ time: '0–1s' }] }
    await scoped.save(project.id, { storyboard: [shot] })
    pending.track = 'S01'
    pending.target = JSON.stringify(shot)
  }
  await scoped.save(project.id, { pendingImages: { [draft.draftId]: pending } })
  await runOperation(operation, { home, imageReviewAllowed: true, uploadGatewayFile: async () => ({ url: 'https://example.test/approved.png' }) })
  const saved = await scoped.read(project.id)
  const picture = kind === 'part' ? saved.characters.items[0].props[0] : saved.boards.S01
  assert.ok(picture.assetId)
  assert.equal(picture.imageUrl, 'https://example.test/approved.png')
}))

test('episode summary regeneration keeps identity and duration, resets only its downstream data', () => fixture(async ({ home, store, project }) => {
  await store.save(project.id, p => addEpisode(p, { summary: '第一集', durationSeconds: 60 }))
  const created = await store.save(project.id, p => addEpisode(p, { summary: '第二集', durationSeconds: 100 }))
  const target = created.episodes[1]
  await scopeProjects(store, target.id).save(project.id, { outline: '旧大纲', characters: { items: [person] }, assembly: { status: 'ready' } })
  const other = (await store.read(project.id)).episodes[0]
  await runOperation({ action: 'episode-generate', projectId: project.id, episodeId: target.id }, { home, generateEpisode: async input => {
    assert.equal(input.episodeId, target.id)
    return { summary: '新的第一集摘要', durationSeconds: 180 }
  } })
  const saved = await store.read(project.id)
  assert.equal(saved.episodes.length, 2)
  assert.deepEqual(saved.episodes[0], other)
  assert.equal(saved.episodes[1].id, target.id)
  assert.equal(saved.episodes[1].durationSeconds, 60)
  assert.equal(saved.episodes[1].summary, '新的第一集摘要')
  assert.equal(saved.episodes[1].outline, null)
  assert.equal(saved.episodes[1].characters, null)
  assert.equal(saved.episodes[1].assembly, null)
}))

test('failed episode regeneration preserves the original summary and production data', () => fixture(async ({ home, store, project }) => {
  const created = await store.save(project.id, p => addEpisode(p, { summary: '原摘要', durationSeconds: 60 }))
  const target = created.episodes[0]
  await scopeProjects(store, target.id).save(project.id, { outline: '原大纲' })
  await assert.rejects(runOperation({ action: 'episode-generate', projectId: project.id, episodeId: target.id }, { home, generateEpisode: async () => { throw new Error('生成失败') } }), /生成失败/)
  const saved = await store.read(project.id)
  assert.equal(saved.episodes[0].summary, '原摘要')
  assert.equal(saved.episodes[0].outline, '原大纲')
  assert.equal(saved.activity, null)
}))

test('a single storyboard can run when only that shot has complete time segments', () => fixture(async ({ home, store, project }) => {
  const row = { range: '0–5s', action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }
  await store.save(project.id, { shots: { items: [{ id: 'S01', duration: 5, seconds: [row] }, { id: 'S02', duration: 5, seconds: [] }], check: { passed: false, failures: ['其他镜头尚未完成'] } } })
  await runOperation({ action: 'shot-storyboard', projectId: project.id, track: 'S01' }, { home, generateShotStoryboard: async ({ shotId }) => [{ id: shotId, title: '分镜' }] })
  assert.equal((await store.read(project.id)).storyboard[0].id, 'S01')
  await assert.rejects(runOperation({ action: 'shot-storyboard', projectId: project.id, track: 'S02' }, { home }), /请先写好这一镜/)
}))

test('video preview reads storyboard mode rather than the old shot table mode', async () => {
  const { previewFilmSubmit } = await import('../server/flow/actions.js')
  const project = { shots: { items: [{ id: 'S01', video: 'first_frame' }] }, characters: { items: [{ id: 'C01', name: 'Mike', imageUrl: 'https://example.test/mike.png' }] } }
  const board = { id: 'S01', duration: 5, video: 'reference', characters: ['Mike'], prompt: { text: 'subject_definitions: <Subject 1> Mike from <Picture 1>.\nsummary: Mike walks.\nretention_analysis: Keep Mike.\ndetailed_description: <Subject 1> walks.\noverall_soundscape: Wind.\nnon_diegetic_music: None.' } }
  assert.equal(previewFilmSubmit(project, board).mode, 'reference')
  assert.equal(previewFilmSubmit(project, { ...board, video: 'text', prompt: { text: 'integrated_multimodal_description: Mike walks.\noverall_soundscape: Wind.\nnon_diegetic_music: None.' } }).mode, 'text')
})

test('regenerating seconds clears only its downstream before a failing model call', () => fixture(async ({ home, store, project }) => {
  const added = await store.save(project.id, addEpisode(project, { summary: '雨夜', durationSeconds: 12 }))
  const episodeId = added.episodes[0].id
  const scoped = scopeProjects(store, episodeId)
  await scoped.save(project.id, {
    shots: { items: [{ id: 'S01', duration: 6, seconds: [{ action: '旧动作' }] }, { id: 'S02', duration: 6, seconds: [{ action: '保留' }] }] },
    storyboard: [{ id: 'S01', prompt: { text: '旧分镜' } }, { id: 'S02', prompt: { text: '保留' } }],
    films: { S01: { status: 'ready' }, S02: { status: 'ready' } }, boards: { S01: { url: 'old' } }, assembly: { status: 'ready' },
  })
  await assert.rejects(runOperation({ action: 'shot-seconds', projectId: project.id, episodeId, track: 'S01' }, {
    home, generateShotSeconds: async ({ project: current }) => {
      assert.deepEqual(current.shots.items[0].seconds, [])
      assert.deepEqual(current.storyboard.map(item => item.id), ['S02'])
      throw new Error('模拟生成失败')
    },
  }), /模拟生成失败/)
  const saved = await scoped.read(project.id)
  assert.deepEqual(saved.storyboard.map(item => item.id), ['S02'])
  assert.equal(saved.films.S01, undefined)
  assert.equal(saved.films.S02.status, 'ready')
  assert.equal(saved.boards.S01, undefined)
  assert.equal(saved.assembly, null)
}))
