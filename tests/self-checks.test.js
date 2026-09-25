import { feedbackOf } from '../client/feedback.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectStore } from '../server/data/projects.js'
import { addEpisode, scopeProjects } from '../server/data/episodes.js'
import { runOperation } from '../server/flow/actions.js'
import { checkReasons, prepareChecks, setCheck } from '../server/data/self-checks.js'
import { pictureTargetSnapshot } from '../server/data/pictures.js'

async function fixture(fn) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-check-'))
  try {
    const root = projectStore(home)
    const project = await root.create({ title: '测试', summary: '故事' })
    const saved = await root.save(project.id, p => addEpisode(p, { summary: '第一集', durationSeconds: 6 }))
    const episodeId = saved.episodes[0].id
    await fn({ home, root, store: scopeProjects(root, episodeId), id: project.id, episodeId })
  } finally { await rm(home, { recursive: true, force: true }) }
}
const row = { range: '0–5s', action: 'walk', camera: 'wide', space: 'desert', audio: 'wind', handoff: 'walk' }

test('failed generation retains feedback; retry without typed feedback reads it and clears only that result', () => fixture(async ({ home, store, id, episodeId }) => {
  await store.save(id, { shots: { items: [{ id: 'S01', duration: 5, seconds: [row] }, { id: 'S02', duration: 5, seconds: [row] }] }, storyboard: [{ id: 'S02', selfCheck: { passed: false, reasons: ['保留第二镜意见'] } }] })
  const operation = { action: 'shot-storyboard', projectId: id, episodeId, track: 'S01' }
  await assert.rejects(runOperation({ ...operation, review: 'Increase environmental scale' }, { home, generateShotStoryboard: async () => { throw new Error('模型输出不完整') } }), /模型输出不完整/)
  let current = await store.read(id)
  assert.deepEqual(feedbackOf(current, 'storyboard:S01').check.failures, [])
  assert.equal(feedbackOf(current, 'storyboard:S01').review.text, 'Increase environmental scale')
  await runOperation(operation, { home, generateShotStoryboard: async ({ project, review }) => {
    assert.match(review, /Increase environmental scale/)
    assert.doesNotMatch(review, /模型输出不完整/)
    return [{ id: 'S01', title: '新分镜' }, project.storyboard[0]]
  } })
  current = await store.read(id)
  assert.equal(feedbackOf(current, 'storyboard:S01').check.passed, true)
  assert.equal(feedbackOf(current, 'storyboard:S01').review.text, '')
  assert.equal(current.storyboard[0].selfCheck, undefined)
  assert.deepEqual(feedbackOf(current, 'storyboard:S02').check.failures, ['保留第二镜意见'])
}))

test('stored outline feedback is submitted with the actual model prompt and cleared after valid output', async t => fixture(async ({ home, store, id, episodeId }) => {
  await store.save(id, setCheck({}, { action: 'outline' }, ['More environment shots', '补充风声']))
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const payload = JSON.parse(options.body)
    const prompt = payload.messages.find(item => item.role === 'user').content
    assert.match(prompt, /More environment shots/)
    assert.match(prompt, /补充风声/)
    return Response.json({ choices: [{ message: { content: '（6秒）沙漠狂风吹过。' } }] })
  })
  await runOperation({ action: 'outline', projectId: id, episodeId }, { home })
  assert.equal(feedbackOf(await store.read(id), 'outline').check.passed, true)
}))

test('a returned but invalid shot table replaces old feedback with current validation failures', () => fixture(async ({ store, id }) => {
  let current = await store.save(id, { shots: { items: [], selfCheck: { passed: false, reasons: ['旧意见'] } } })
  const prepared = await prepareChecks(store, current, { action: 'shots' })
  await prepared.store.save(id, { shots: { items: [], check: { passed: false, failures: ['时长不足'] } }, activity: null })
  current = await store.read(id)
  assert.deepEqual(feedbackOf(current, 'shots').check.failures, ['时长不足'])
}))

test('shot table keeps review and check failures as separate fields for regenerate', () => fixture(async ({ home, store, id, episodeId }) => {
  await store.save(id, {
    scenes: { items: [{ id: 'L01', name: '荒原' }] },
    shots: {
      items: [{ id: 'S01', duration: 6, hook: 'reveal', cast: [], continuity: '站立', anchors: { landmark: '沙丘', positions: '中景', exited: '—', light: '顶光' }, audio: { voiceover: '', dialogue: '走', sfx: '', performance: '' }, seconds: [] }],
      check: { passed: false, failures: ['镜头总时长 6s，需要落在 1–16s'] },
      review: '打架不要切这么碎',
    },
  })
  const reasons = checkReasons(await store.read(id), {
    action: 'shots',
    checkFailures: ['镜头总时长 6s，需要落在 1–16s'],
  })
  assert.ok(reasons.includes('打架不要切这么碎'))
  assert.ok(reasons.some(item => item.includes('镜头总时长')))

  await runOperation({
    action: 'shots', projectId: id, episodeId,
    review: '打架不要切这么碎',
    checkFailures: ['镜头总时长 6s，需要落在 1–16s'],
  }, {
    home,
    generateShots: async ({ review }) => {
      assert.match(review, /打架不要切这么碎/)
      assert.match(review, /镜头总时长/)
      return {
        items: [{ id: 'S01', duration: 6, hook: 'reveal', cast: [], continuity: '站立', anchors: { landmark: '沙丘', positions: '中景', exited: '—', light: '顶光' }, audio: { voiceover: '', dialogue: '走', sfx: '', performance: '' }, seconds: [] }],
        check: { passed: true, failures: [] },
      }
    },
  })
  const saved = await store.read(id)
  assert.equal(feedbackOf(saved, 'shots').review.text, '')
  assert.equal(feedbackOf(saved, 'shots').review.history.at(-1).text, '打架不要切这么碎')
  assert.equal(feedbackOf(saved, 'shots').check.passed, true)
}))

test('image feedback stays separate from character content and does not invalidate draft identity', () => {
  const item = { id: 'C01', name: 'Mike' }
  const project = { characters: { items: [item] } }
  const before = pictureTargetSnapshot(item)
  setCheck(project, { action: 'image', itemId: 'C01' }, ['黑色短裤'])
  assert.deepEqual(checkReasons(project, { action: 'image', itemId: 'C01' }), ['黑色短裤'])
  assert.equal(pictureTargetSnapshot(item), before)
  setCheck(project, { action: 'image', itemId: 'C01' }, [])
  assert.equal(item.imageSelfCheck, undefined)
})

test('summary retries receive saved feedback and remove it from the same episode on success', () => fixture(async ({ home, store, id, episodeId }) => {
  await store.save(id, setCheck({}, { action: 'episode-generate' }, ['开场要交代环境']))
  await runOperation({ action: 'episode-generate', projectId: id, episodeId }, { home, generateEpisode: async ({ project }) => {
    assert.deepEqual(feedbackOf(project.episodes[0], 'summary').check.failures, ['开场要交代环境'])
    return { summary: '荒原上一名旅人缓慢走过。', durationSeconds: 6 }
  } })
  assert.equal(feedbackOf(await store.read(id), 'summary').check.passed, true)
}))

test('an unrelated intermediate save does not consume pending feedback', () => fixture(async ({ store, id }) => {
  const current = await store.save(id, setCheck({}, { action: 'outline' }, ['缺少结尾']))
  const prepared = await prepareChecks(store, current, { action: 'outline' })
  await prepared.store.save(id, { activity: 'outline' })
  assert.deepEqual(feedbackOf(await store.read(id), 'outline').check.failures, ['缺少结尾'])
  await prepared.store.save(id, { activity: null, activityError: '连接失败' })
  assert.deepEqual(feedbackOf(await store.read(id), 'outline').check.failures, ['缺少结尾'])
}))

test('a batch failure records only the failing shot after clearing completed shots', () => fixture(async ({ home, store, id, episodeId }) => {
  await store.save(id, { shots: { items: [
    { id: 'S01', duration: 5, seconds: [], secondsSelfCheck: { passed: false, reasons: ['修正第一镜'] } },
    { id: 'S02', duration: 5, seconds: [], secondsSelfCheck: { passed: false, reasons: ['修正第二镜'] } },
  ] } })
  await assert.rejects(runOperation({ action: 'seconds', projectId: id, episodeId }, { home, generateShotSeconds: async ({ project, shotId }) => {
    if (shotId === 'S02') throw new Error('第二镜失败')
    return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: [row] } : item) }
  } }), /第二镜失败/)
  const saved = await store.read(id)
  assert.equal(feedbackOf(saved, 'seconds:S01').check.passed, true)
  assert.deepEqual(feedbackOf(saved, 'seconds:S02').check.failures, ['修正第二镜'])
}))

test('every generation target separates human review from self-check and consumes both on success', () => fixture(async ({ store, id }) => {
  const operations = [
    { action: 'episode-generate' }, { action: 'outline' }, { action: 'characters' }, { action: 'scenes' }, { action: 'shots' },
    { action: 'revise-shot', track: 'S01' }, { action: 'shot-seconds', track: 'S01' }, { action: 'shot-storyboard', track: 'S01' },
    { action: 'image', itemId: 'C01' }, { action: 'part-image', itemId: 'C01', slot: 'props' },
    { action: 'pencil', track: 'S01' }, { action: 'film', track: 'S01' }, { action: 'assemble' },
  ]
  for (const operation of operations) {
    let project = await store.save(id, current => setCheck(current, operation, ['结构不完整']))
    let prepared = await prepareChecks(store, project, { ...operation, review: 'Use an English description' })
    assert.match(prepared.operation.review, /结构不完整/)
    assert.match(prepared.operation.review, /Use an English description/)
    await prepared.store.save(id, { activity: null, activityError: '连接失败' })
    project = await store.read(id)
    assert.deepEqual(feedbackOf(project, operation).check.failures, ['结构不完整'])
    assert.equal(feedbackOf(project, operation).review.text, 'Use an English description')
    prepared = await prepareChecks(store, project, operation)
    await prepared.store.save(id, { activity: null, activityError: null })
    const record = feedbackOf(await store.read(id), operation)
    assert.deepEqual(record.check, { passed: true, failures: [] })
    assert.equal(record.review.text, '')
    assert.equal(record.review.status, 'pending')
    assert.equal(record.review.history.at(-1).text, 'Use an English description')
  }
}))

test('image revision instruction is persisted as human review rather than a check error', () => fixture(async ({ store, id }) => {
  const operation = { action: 'revise-image', itemId: 'C01', instruction: '改为黑色短裤' }
  const prepared = await prepareChecks(store, await store.read(id), operation)
  await prepared.store.save(id, { activity: null, activityError: '图片接口失败' })
  const record = feedbackOf(await store.read(id), operation)
  assert.equal(record.review.text, '改为黑色短裤')
  assert.deepEqual(record.check.failures, [])
}))

test('shot asset selection saves metadata and invalidates only that storyboard downstream', () => fixture(async ({ home, store, id, episodeId }) => {
  await store.save(id, {
    characters: { items: [{ id: 'C01', name: '甲' }] }, scenes: { items: [{ id: 'E01', name: '街道' }] },
    shots: { items: [{ id: 'S01', text: '原文', secondsText: '时间线', cast: [] }, { id: 'S02', text: '保留' }] },
    storyboard: [{ id: 'S01' }, { id: 'S02' }], films: { S01: { status: 'ready' }, S02: { status: 'ready' } }, assembly: { status: 'ready' },
  })
  await runOperation({ action: 'shot-assets', projectId: id, episodeId, track: 'S01', characterIds: ['C01'], sceneId: 'E01', referenceIds: [] }, { home })
  const saved = await store.read(id)
  assert.equal(saved.shots.items[0].text, '原文')
  assert.equal(saved.shots.items[0].secondsText, '时间线')
  assert.deepEqual(saved.shots.items[0].cast, ['甲'])
  assert.equal(saved.shots.items[0].scene, '街道')
  assert.deepEqual(saved.storyboard.map(item => item.id), ['S02'])
  assert.equal(saved.films.S01, undefined)
  assert.equal(saved.films.S02.status, 'ready')
  assert.equal(saved.assembly, null)
}))
