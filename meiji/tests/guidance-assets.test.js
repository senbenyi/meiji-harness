import { reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { setupModel } from './fixtures/model.js'
import { assetStore } from '../server/data/asset-library-store.js'
import { assetsPatch, loadGuidanceAssets } from '../server/data/guidance-assets.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { addEpisode } from '../shared/episode-rules.js'
import { projectStore, revisionStore } from '../server/data/project-store.js'
import { buildTextPrompts } from '../server/prompts/text-prompts.js'
import { runOperation } from '../server/flow/operations/run-operation.js'
import { saveIncoming } from '../server/flow/operations/project-operations.js'
import { produceShots } from '../server/flow/operations/video-operations.js'
import { setContent } from '../shared/drama-model.js'
import { guidanceTypes } from '../shared/guidance-categories.js'

const guidance = (id, type = 'action', content = '动作参考') => ({ id, name: `${id}.md`, guidanceType: type, content })
const importGuide = (home, type = 'action', content = '动作参考') => assetStore(home).import('guidance', `${type}.md`, Readable.from([Buffer.from(content)]), undefined, { guidanceType: type })

test('staged library action preserves guidance classification and loads server-owned content', async t => {
  const e = await setupModel(t)
  const incomingId = await saveIncoming(e.home, { name: '对白.md', category: 'guidance', mime: 'text/plain', bytes: Buffer.from('对白参考：别来无恙。') })
  await runOperation({ action: 'library-import', incomingId, category: 'guidance', guidanceType: 'dialogue', name: '对白.md' }, { home: e.home })
  const [asset] = await assetStore(e.home).list('guidance')
  assert.equal(asset.guidanceType, 'dialogue')
  assert.deepEqual(await loadGuidanceAssets(e.home, [asset.id, asset.id]), [{ id: asset.id, name: '对白.md', guidanceType: 'dialogue', content: '对白参考：别来无恙。' }])
  await assert.rejects(loadGuidanceAssets(e.home, ['../../secret']), { status: 400 })
  await assert.rejects(loadGuidanceAssets(e.home, ['00000000-0000-4000-8000-000000000000']), { status: 400 })
  await assert.rejects(loadGuidanceAssets(e.home, Array(21).fill(asset.id)), { status: 400 })
  const large = await Promise.all(Array.from({ length: 4 }, () => importGuide(e.home, 'other', '字'.repeat(20000))))
  await assert.rejects(loadGuidanceAssets(e.home, large.map(asset => asset.id)), /60000/)
})

test('selections are saved per stage for the whole drama and clear without changing content or files', async t => {
  const e = await setupModel(t), asset = await importGuide(e.home)
  const saved = await e.store.save(e.id, current => addEpisode(current, { summary: '第二集', durationSeconds: 10 }))
  const otherId = saved.episodes[0].id
  const assets = await loadGuidanceAssets(e.home, [asset.id])
  await e.store.save(e.id, current => assetsPatch(current, 'outline', assets))
  await e.store.save(e.id, current => assetsPatch(current, 'seconds', assets))
  const reloaded = await scopeProjects(projectStore(e.home), e.episodeId).read(e.id)
  assert.deepEqual(reloaded.skills.assets.outline, assets)
  assert.deepEqual((await scopeProjects(e.store, otherId).read(e.id)).skills.assets.outline, assets)
  await e.store.save(e.id, current => assetsPatch(current, 'outline', []))
  const cleared = await scopeProjects(e.store, e.episodeId).read(e.id)
  assert.equal(cleared.skills.assets.outline, undefined)
  assert.deepEqual(cleared.skills.assets.seconds, assets)
  assert.equal(cleared.plot.outline.content, reloaded.plot.outline.content)
  assert.equal((await assetStore(e.home).list('guidance')).length, 1)
  assert.throws(() => assetsPatch(cleared, 'bad', []), /阶段无效/)
})

test('assets are grouped by guidance skill with the same context for generation, review and revision', () => {
  const assets = guidanceTypes.map(([type]) => guidance(type, type, `REFERENCE_${type}`))
  const project = { skills: { assets: { seconds: assets, outline: [guidance('OUTSIDE_STAGE')] } } }
  const task = { project, skill: 'seconds', instructions: '生成当前镜头', opinion: '本次修改' }
  const prompts = buildTextPrompts(task)
  for (const message of [prompts.generation, prompts.review('待审'), prompts.revision('旧稿', reviewFail('缺少动作'))]) {
    assert.match(message.user, /【expression参考素材】/)
    assert.match(message.user, /【sound参考素材】/)
    assert.match(message.user, /【dialogue参考素材】/)
    assert.match(message.user, /【martial参考素材】/)
    assert.match(message.user, /【其他参考素材】/)
    assert.doesNotMatch(message.user, /OUTSIDE_STAGE/)
    for (const asset of assets) assert.ok(message.user.includes(asset.content))
  }
  // 动作与特效同属动作指导，声音与配乐同属声音指导：各自只出现在一个分组。
  assert.equal(prompts.generation.user.match(/【action参考素材】/g).length, 1)
  assert.ok(prompts.generation.user.indexOf('REFERENCE_effect') < prompts.generation.user.indexOf('【martial参考素材】'))
  assert.match(prompts.review('待审').system, /未采用可选参考不判失败/)
})

test('film selection changes preserve artifacts and production recompiles before resubmission', async t => {
  const e = await setupModel(t), scope = scopeProjects(e.store, e.episodeId)
  await scope.save(e.id, current => {
    setContent(current.shots.items[0].video, { status: 'ready', file: 'old.mp4' }, { passed: true, failures: [] })
    return { shots: current.shots }
  })
  await e.store.save(e.id, current => assetsPatch(current, 'film', [guidance('action')]))
  const changed = await e.read()
  assert.equal(changed.shots.items[0].video.content.file, 'old.mp4')
  assert.equal(changed.shots.items[0].storyboard.stale, true)
  assert.equal(changed.shots.items[0].storyboard.check.passed, false)
  const calls = []
  await produceShots(e.op('produce', { track: 'S01' }), { home: e.home }, async op => {
    calls.push(op.action)
    await scope.save(e.id, current => {
      const shot = current.shots.items[0]
      if (op.action === 'shot-storyboard') setContent(shot.storyboard, shot.storyboard.content, { passed: true, failures: [] })
      else {
        setContent(shot.video, { status: 'ready', file: 'new.mp4' }, { passed: true, failures: [] })
        setContent(shot.tailFrame, { sourceVideoFile: 'new.mp4', localPath: '/tail.png' }, { passed: true, failures: [] })
      }
      return { shots: current.shots }
    })
    return []
  })
  assert.deepEqual(calls, ['shot-storyboard', 'film'])
  await e.store.save(e.id, current => assetsPatch(current, 'film', [guidance('action')]))
  assert.equal((await e.read()).shots.items[0].storyboard.stale, false)
  await e.store.save(e.id, current => assetsPatch(current, 'film', []))
  assert.equal((await e.read()).shots.items[0].storyboard.stale, true)
})

test('guide selection changes do not invalidate an in-flight shot task', async t => {
  const e = await setupModel(t), job = revisionStore(e.store, 'task', { episodeId: e.episodeId, track: 'S01', action: 'shot-seconds' })
  await job.read(e.id)
  await e.store.save(e.id, current => assetsPatch(current, 'seconds', [guidance('new')]))
  await job.save(e.id, { title: '结果' })
})

test('guidance HTTP endpoints resolve local IDs and reject missing assets without partial saves', async t => {
  const { registerPanel } = await import('../server/http/panel-routes.js')
  const { linkStore } = await import('../server/data/workspace-links.js')
  const e = await setupModel(t), sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  let handler
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = e.home
  try {
    registerPanel({ connection: { requestRejection: () => null }, webServer: { register: route => { handler = route.handler } }, effect: fn => fn(), on() {}, logger: { warn() {} } })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
  const call = async (path, fields, headers = { 'x-meiji-request': '1' }) => {
    let status, value
    await handler({ url: '/plugins/meiji/' + path, method: 'PUT', headers, async *[Symbol.asyncIterator]() { yield JSON.stringify({ projectId: e.id, sessionId, ...fields }) } }, {
      writeHead(code) { status = code }, end(text) { value = JSON.parse(text) },
    })
    return { status, ...value }
  }
  const asset = await importGuide(e.home, 'expression', '真实本地内容')
  assert.equal((await call('project-guidance', { stage: 'outline', guidanceAssetIds: [asset.id], guidanceAssets: [{ content: '伪造内容' }] })).status, 200)
  assert.equal((await e.read()).skills.assets.outline[0].content, '真实本地内容')
  assert.equal((await call('project-guidance', { stage: 'outline', guidanceAssetIds: ['00000000-0000-4000-8000-000000000000'] })).status, 400)
  assert.equal((await e.read()).skills.assets.outline[0].content, '真实本地内容')
  assert.equal((await call('project-guidance', { stage: 'outline', guidanceAssetIds: [] }, {})).status, 403)
  assert.equal((await call('project-skills', { skill: 'outline', fields: { generate: 'x' } }, {})).status, 403)
  assert.equal((await call('project-guidance', { stage: 'outline', guidanceAssetIds: [] })).status, 200)
  assert.equal((await e.read()).skills.assets.outline, undefined)
})
