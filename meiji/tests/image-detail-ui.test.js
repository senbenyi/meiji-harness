import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { episodeFixture } from './fixtures/model.js'
import { renderStage, renderSceneDetail } from '../client/generation-stage-views.js'
import { renderSession } from '../client/project-session-view.js'

function setup(t) {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost' })
  const prior = { document: globalThis.document, window: globalThis.window, CustomEvent: globalThis.CustomEvent }
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, CustomEvent: dom.window.CustomEvent })
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
  const project = episodeFixture()
  project.episodeId = project.id
  const second = structuredClone(project.plot.characters.items[0])
  second.id = 'C02'; second.name = '同行人'; second.image.id = 'image:C02'
  project.plot.characters.items.push(second)
  return project
}

test('人物卡分离竖幅图片、资料和底部操作，详情与生图各自可点击', t => {
  const project = setup(t), opened = []
  const page = renderStage('assets', project, { fail() {} }, {
    onOpenCharacter: (...args) => opened.push(args), onOpenScene: (...args) => opened.push(args),
  })
  assert.equal(page.querySelector('.character-refresh'), null)
  assert.equal(page.querySelector('.asset-placeholder'), null)
  assert.equal(page.querySelector('.asset-actions'), null)
  assert.equal(page.querySelector('.character-card-id').textContent, 'C01')
  for (const [selector, media] of [['.character-card', '.character-thumb']]) {
    const card = page.querySelector(selector), button = card.querySelector('.card-image-generate')
    assert.ok(button);assert.equal(button.textContent, 'AI生图')
    assert.ok(button.closest('.character-card-footer'))
    assert.ok(card.querySelector('.character-card-footer .json-copy-row'))
    assert.equal(card.querySelector('.character-card-media .card-image-generate'), null)
    assert.ok(card.querySelector(media).compareDocumentPosition(button) & 4)
    assert.equal(button.closest('button button'), null)
    assert.equal(button.closest('.character-open'), null)
  }
  page.querySelector('[aria-label="人物详情：旅人"]').click()
  assert.equal(page.querySelector('[aria-label="场景详情：庭院"]'), null)
  assert.deepEqual(opened, [[project.episodeId, 'C01']])
})

for (const [itemId, name, kind] of [['C01', '旅人', 'characters'], ['C02', '同行人', 'characters']]) {
  test(`${name} list AI image generation always uses text mode, with or without existing pictures`, async t => {
    const project = setup(t), calls = []
    const item = project.plot[kind].items.find(item => item.id === itemId)
    for (const present of [false, true]) {
      item.image.content = present ? { localPath: '/existing.png' } : null
      item.reference = { localPath: '/reference.png' }
      const page = renderStage('assets', project, { beginImage: async (...args) => calls.push(args), fail() {} }, {})
      const button = page.querySelector(`[aria-label="AI生图：${name}"]`)
      button.click();button.click();await Promise.resolve()
      assert.equal(button.disabled, true)
      assert.deepEqual(calls.at(-1).slice(1), ['image', { itemId, itemName: name, generationMode: 'regenerate', useReference: false }])
    }
    assert.equal(calls.length, 2)
  })
}

test('list image generation is disabled while busy and restores its button on failure', async t => {
  const project = setup(t)
  project.executionLocks = [{ target: 'outline', scope: 'project', episodeId: project.episodeId }] // 剧情步骤持有项目锁
  let page = renderStage('assets', project, { beginImage: () => assert.fail('must not generate while busy') }, {})
  for (const button of page.querySelectorAll('.card-image-generate')) { assert.equal(button.disabled, true);button.click() }
  project.executionLocks = []
  page = renderStage('assets', project, { beginImage: async () => { throw new Error('生图请求失败') } }, {})
  const button = page.querySelector('[aria-label="AI生图：旅人"]')
  button.click();await new Promise(resolve => setImmediate(resolve))
  assert.equal(button.disabled, false);assert.equal(button.textContent, 'AI生图')
  assert.match(page.querySelector('.character-error').textContent, /生图请求失败/)
})

for (const [itemId, name, kind] of [['C01', '旅人', 'characters'], ['C02', '同行人', 'characters']]) {
  for (const action of ['confirm-image', 'discard-image']) {
    test(`${name} card previews its candidate and supports ${action} without leaving the list`, async t => {
      const project = setup(t), calls = []
      const item = project.plot[kind].items.find(item => item.id === itemId)
      item.image.content = { localPath: '/old.png' }
      project.pendingImages = { draft: { draftId: 'draft', itemId, name, previewUrl: '/candidate.png' } }
      const actions = { beginImage() {}, async reviewImage(...args) {
        calls.push(args)
        if (action === 'confirm-image') item.image.content = { localPath: '/candidate.png' }
        delete project.pendingImages.draft
      } }
      const page = renderStage('assets', project, actions, {})
      const card = [...page.querySelectorAll('.character-card')].find(card => card.querySelector('.character-card-id').textContent === itemId)
      assert.equal(card.querySelector('img').getAttribute('src'), '/candidate.png')
      assert.deepEqual([...card.querySelectorAll('.detail-image-buttons button')].map(button => button.textContent), ['放弃', '确定'])
      assert.equal(card.querySelector('.card-image-generate'), null)
      assert.equal(page.querySelector('.image-review-overlay'), null)
      const button = [...card.querySelectorAll('.detail-image-buttons button')].find(button => button.textContent === (action === 'confirm-image' ? '确定' : '放弃'))
      button.click(); button.click(); await new Promise(resolve => setImmediate(resolve))
      assert.equal(calls.length, 1)
      assert.deepEqual(calls[0].slice(1), [project.episodeId, 'draft', action])
      const updated = [...renderStage('assets', project, actions, {}).querySelectorAll('.character-card')].find(card => card.querySelector('.character-card-id').textContent === itemId)
      assert.equal(updated.querySelector('img').getAttribute('src'), action === 'confirm-image' ? '/candidate.png' : '/old.png')
      assert.ok(updated.querySelector('.card-image-generate'))
      assert.equal(updated.querySelector('.detail-image-buttons'), null)
    })
  }
}

test('generating cards disable confirmation and discard until their own candidate is ready', t => {
  const project = setup(t)
  project.executionLocks = [{ target: 'image:C01', scope: 'episode', episodeId: project.episodeId }]
  const page = renderStage('assets', project, { beginImage() {}, reviewImage() { assert.fail('still generating') } }, {
    imageGate: { itemId: 'C01', episodeId: project.episodeId, phase: 'generating', held: true },
  })
  const buttons = page.querySelectorAll('.character-card .detail-image-buttons button')
  assert.equal(buttons.length, 2)
  for (const button of buttons) { assert.equal(button.disabled, true); button.click() }
  assert.equal(page.querySelector('.scene-card .detail-image-buttons'), null)
})

test('candidate review failure restores the card buttons and preserves the preview', async t => {
  const project = setup(t)
  project.pendingImages = { draft: { draftId: 'draft', itemId: 'C01', name: '旅人', previewUrl: '/candidate.png' } }
  const page = renderStage('assets', project, { async reviewImage() { throw new Error('保存图片失败') } }, {})
  const card = page.querySelector('.character-card')
  card.querySelector('.detail-image-buttons .primary').click()
  assert.ok([...card.querySelectorAll('.detail-image-buttons button')].every(button => button.disabled))
  await new Promise(resolve => setImmediate(resolve))
  assert.match(card.querySelector('.detail-image-error').textContent, /保存图片失败/)
  assert.ok([...card.querySelectorAll('.detail-image-buttons button')].every(button => !button.disabled))
  assert.equal(card.querySelector('img').getAttribute('src'), '/candidate.png')
})

test('会话恢复人物候选，不恢复场景候选且不使用其他集的图片门禁', t => {
  const episode = setup(t)
  episode.pendingImages = {
    character: { draftId: 'character', itemId: 'C01', name: '旅人', previewUrl: '/character.png' },
    scene: { draftId: 'scene', itemId: 'E01', name: '庭院', previewUrl: '/scene.png' },
  }
  const root = { id: 'project', title: '剧', summary: { content: '' }, episodes: [episode] }
  const page = renderSession(root, () => {}, {}, { episodeId: episode.id, tab: 'assets', imageGate: {
    itemId: 'C01', episodeId: 'other-episode', phase: 'ready', previewUrl: '/other.png', draftId: 'other',
  } })
  assert.equal(page.querySelector('.character-card img').getAttribute('src'), '/character.png')
  assert.equal(page.querySelector('.scene-card'), null)
  assert.equal(page.querySelectorAll('.card-image-review').length, 1)
  assert.equal(page.querySelector('.image-review-overlay'), null)
  assert.doesNotMatch(page.textContent, /图片任务请在详情页查看与确认/)
})

test('image details expose image history and their own basic skill beside generation controls', t => {
  const project = setup(t), calls = []
  const actions = { openHistory: (...args) => calls.push(['history', args[1]]), openSkill: (...args) => calls.push(['skill', args[1]]) }
  const scene = renderSceneDetail(project, 'E01', actions, {})
  scene.querySelector('.task-history-entry').click()
  scene.querySelector('[aria-label="场景图片 skill"]').click()
  assert.deepEqual(calls, [['history', 'scenes,image:E01'], ['skill', 'scene-image']])
  assert.ok(scene.querySelector('.scene-image-tools .primary'))
})

for (const [itemId, name, key, label] of [['C01', '旅人', 'onOpenCharacter', '查看人物详情'], ['E01', '庭院', 'onOpenScene', '查看场景详情']]) {
  test(`${name} restored candidate links to detail instead of a separate image page`, t => {
    const episode = setup(t), opened = []
    episode.pendingImages = { draft: { draftId: 'draft', itemId, name, previewUrl: '/draft.png' } }
    const root = { id: 'project', title: '剧', summary: { content: '' }, episodes: [episode] }
    const page = renderSession(root, () => {}, {}, { [key]: (...args) => opened.push(args) })
    assert.equal(page.querySelector('.image-review-overlay'), null)
    const open = [...page.querySelectorAll('button')].find(button => button.textContent === label)
    assert.ok(open)
    open.click()
    assert.deepEqual(opened, [[episode.id, itemId]])
    assert.equal(episode.pendingImages.draft.previewUrl, '/draft.png')
  })
}


test('已有道具不再展示、生成或删除，人物入口保留', t => {
  const project = setup(t)
  project.plot.props.items = [{ id: 'P01', type: 'prop', name: '旧信', category: 'prop', description: '泛黄旧信', evidence: '旅人拿着旧信' }]
  const page = renderStage('assets', project, { perform: () => assert.fail('不应操作道具'), beginImage: () => assert.fail('不应自动生成') }, {})
  assert.equal(page.querySelector('[aria-label="道具图片 skill"]'), null)
  assert.equal(page.querySelector('[aria-label="删除道具：旧信"]'), null)
  assert.doesNotMatch(page.textContent, /泛黄旧信|道具/)
  assert.ok(page.querySelector('.character-card'))
})
