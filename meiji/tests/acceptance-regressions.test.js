import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { JSDOM } from './fixtures/jsdom.js'
import { runOperation } from './fixtures/operation.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { taskRegistry } from '../server/flow/tasks/task-registry.js'
import { filmSubmit } from '../server/flow/steps/shared/video-submit.js'
import { feedbackOf, overrideBlocker } from '../shared/review-feedback.js'
import { validateSeconds } from '../shared/seconds-content.js'
import { syncImageGate, gateFromAction } from '../client/image-review.js'
import { appendWorkflowReview } from '../client/workflow-review.js'

function dom(t) {
  const page = new JSDOM('<body></body>')
  const prior = globalThis.document
  globalThis.document = page.window.document
  t.after(() => { globalThis.document = prior; page.window.close() })
  return document.body
}

for (const change of ['replace', 'remove', 'seconds']) {
  test(`批量成片在 ${change} 后重组过期提示词`, () => {
    const project = episodeFixture(), shot = project.shots.items[0]
    const image = project.plot.characters.items[0].image
    image.content = { assetId: 'old', localPath: '/old.png', assetCategory: 'characters' }
    shot.storyboard.content = compileVideoPrompt(project, shot)
    const skip = () => taskRegistry['storyboard-prompt'].skip(project, { track: shot.id })
    assert.equal(skip(), true)
    if (change === 'replace') image.content = { assetId: 'new', localPath: '/new.png', assetCategory: 'characters' }
    if (change === 'remove') image.content = null
    if (change === 'seconds') shot.seconds.revision++
    assert.equal(skip(), false)
    shot.storyboard.content = compileVideoPrompt(project, shot)
    assert.equal(skip(), true)
    assert.doesNotThrow(() => filmSubmit(project, { ...shot.storyboard.content, id: shot.id }, {}))
  })
}

test('格式错误的人工分镜在面板及服务端均不可放行，有效语义失败仍可放行', async t => {
  const parent = dom(t), e = await setupModel(t)
  await e.store.save(e.id, project => {
    const board = project.episodes[0].shots.items[0].storyboard
    board.content.prompt.text = '格式校验测试：缺少必需字段。'
    board.status = 'failed'
    board.check = { passed: false, failures: ['缺少必需字段'], revision: board.revision }
    return project
  })
  let project = await e.read()
  assert.match(overrideBlocker(project, 'storyboard:S01'), /格式错误/)
  appendWorkflowReview(parent, feedbackOf(project, 'storyboard:S01'), true)
  assert.equal(parent.querySelector('.workflow-review-override'), null)
  await assert.rejects(runOperation(e.op('review-override', { key: 'storyboard:S01', origin: 'panel' }), { home: e.home }), /格式错误/)
  assert.equal((await e.read()).shots.items[0].storyboard.check.passed, false)
  await e.store.save(e.id, p => {
    p.episodes[0].shots.items[0].storyboard.content = compileVideoPrompt(p.episodes[0], p.episodes[0].shots.items[0])
    return p
  })
  project = await e.read()
  assert.equal(overrideBlocker(project, 'storyboard:S01'), null)
  await runOperation(e.op('review-override', { key: 'storyboard:S01', origin: 'panel' }), { home: e.home })
  assert.equal((await e.read()).shots.items[0].storyboard.check.passed, true)
})

for (const itemId of ['C01', 'E01', 'P01']) {
  test(`${itemId} 确认图片后的上传状态在操作结束时清除`, () => {
    const episode = episodeFixture(), project = { episodes: [episode] }
    episode.operationActivity = 'confirm-image'
    let gate = syncImageGate(project, null)
    assert.equal(gate.phase, 'uploading')
    episode.operationActivity = null
    assert.equal(syncImageGate(project, gate), null)
    gate = gateFromAction('image', { itemId, episodeId: episode.id })
    assert.equal(syncImageGate(project, gate).phase, 'generating')
    episode.operationActivity = `image:${itemId}`
    assert.equal(syncImageGate(project, gate).phase, 'generating')
    episode.pendingImages = { draft: { draftId: 'draft', itemId, previewUrl: '/new.png' } }
    gate = syncImageGate(project, gate)
    assert.equal(gate.phase, 'ready')
    episode.pendingImages = {}; episode.operationActivity = 'confirm-image'
    gate = syncImageGate(project, gate)
    assert.equal(gate.phase, 'uploading')
    episode.operationActivity = null
    assert.equal(syncImageGate(project, gate), null)
  })
}

test('总览不重复展示带镜头前缀的自审失败，同时保留真正的执行错误', t => {
  const parent = dom(t), project = episodeFixture(), seconds = project.shots.items[0].seconds
  seconds.check = { passed: false, failures: ['实体标记错误'] }
  seconds.error = '自审未通过：实体标记错误'
  appendWorkflowReview(parent, feedbackOf(project, 'seconds'), true)
  assert.equal(parent.textContent.split('实体标记错误').length - 1, 1)
  parent.replaceChildren(); seconds.error = '模型网关断开'
  appendWorkflowReview(parent, feedbackOf(project, 'seconds'), true)
  assert.match(parent.textContent, /模型网关断开/)
  assert.match(parent.textContent, /实体标记错误/)
})

test('实体修订意见列出全部漏标字段及原文，保留失败正文', () => {
  const project = episodeFixture(), shot = project.shots.items[0], content = shot.seconds.content
  content.beats[0].durationMs = 2500
  content.beats[0].camera = '平视拍摄旅人入场'
  content.beats.push({ ...content.beats[0], id: 'B02', camera: '追随旅人向北' })
  const before = structuredClone(content)
  assert.throws(() => validateSeconds(content, shot, project), error => {
    for (const fragment of ['S01/B01.camera', 'S01/B02.camera', '平视拍摄旅人入场', '追随旅人向北', '旅人【旅人|C01】']) assert.ok(error.message.includes(fragment), fragment)
    return true
  })
  assert.deepEqual(content, before)
})

test('真实批量成片在换图后重新编译各镜、提交新图并接续新尾帧', async t => {
  const e = await setupModel(t), submitted = []
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7T8AAAAASUVORK5CYII='
  const upload = () => runOperation(e.op('import-image', { itemId: 'C01', data, mime: 'image/png' }), { home: e.home })
  await upload()
  await e.store.save(e.id, p => {
    const episode = p.episodes[0]
    for (const shot of episode.shots.items) shot.storyboard.content = compileVideoPrompt(episode, shot)
    return p
  })
  const oldAsset = (await e.read()).plot.characters.items[0].image.content.assetId
  await upload()
  const newAsset = (await e.read()).plot.characters.items[0].image.content.assetId
  assert.notEqual(newAsset, oldAsset)
  // 整集成片按镜头顺序接续：后一镜等前一镜尾帧完成后再编译分镜。
  await runOperation(e.op('film'), {
    home: e.home,
    submitH3: async ({ items }) => {
      submitted.push(items[0])
      return { baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: item.track })) }
    },
    retrieveGatewayVideo: async () => Buffer.from('test video'),
    saveLastFrame: async (_, destination) => writeFile(destination, Buffer.from(data, 'base64')),
  })
  assert.deepEqual(submitted.map(item => item.track), ['S01', 'S02'])
  assert.deepEqual(submitted.map(item => item.referenceImages.length), [1, 2])
  const project = await e.read()
  for (const shot of project.shots.items) {
    assert.equal(shot.video.status, 'passed')
    assert.equal(shot.tailFrame.status, 'passed')
    assert.equal(shot.storyboard.content.referenceSnapshot[0].assetId, newAsset)
  }
  assert.equal(project.shots.items[1].storyboard.content.tailReference.sourceVideoFile, project.shots.items[0].video.content.file)
})
