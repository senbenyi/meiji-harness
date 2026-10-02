import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { episodeFixture } from './fixtures/model.js'
import { renderStage, renderSceneDetail } from '../client/stages.js'
import { renderCharacterDetail } from '../client/character.js'
import { renderSession } from '../client/session.js'

function setup(t) {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost' })
  const prior = { document: globalThis.document, window: globalThis.window, CustomEvent: globalThis.CustomEvent }
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, CustomEvent: dom.window.CustomEvent })
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
  const project = episodeFixture()
  project.episodeId = project.id
  return project
}

test('character and scene lists show IDs and image generation below each picture, while details stay available', t => {
  const project = setup(t), opened = []
  const page = renderStage('script', project, { fail() {} }, {
    onOpenCharacter: (...args) => opened.push(args), onOpenScene: (...args) => opened.push(args),
  })
  assert.equal(page.querySelector('.character-refresh'), null)
  assert.equal(page.querySelector('.asset-placeholder'), null)
  assert.equal(page.querySelector('.asset-actions'), null)
  assert.equal(page.querySelector('.character-card-id').textContent, 'C01')
  for (const [selector, media] of [['.character-card', '.character-thumb'], ['.scene-card', '.scene-card-media']]) {
    const card = page.querySelector(selector), button = card.querySelector('.card-image-generate')
    assert.ok(button);assert.equal(button.textContent, 'AI生图')
    assert.ok(button.parentElement.contains(card.querySelector(media)))
    assert.ok(card.querySelector(media).compareDocumentPosition(button) & 4)
    assert.equal(button.closest('button button'), null)
  }
  page.querySelector('[aria-label="人物详情：旅人"]').click()
  page.querySelector('[aria-label="场景详情：庭院"]').click()
  assert.deepEqual(opened, [[project.episodeId, 'C01'], [project.episodeId, 'E01']])
})

for (const [itemId, name, kind] of [['C01', '旅人', 'characters'], ['E01', '庭院', 'scenes']]) {
  test(`${name} list AI image generation always uses text mode, with or without existing pictures`, async t => {
    const project = setup(t), calls = []
    const item = project.plot[kind].items[0]
    for (const present of [false, true]) {
      item.image.content = present ? { localPath: '/existing.png' } : null
      item.reference = { localPath: '/reference.png' }
      const page = renderStage('script', project, { beginImage: async (...args) => calls.push(args), fail() {} }, {})
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
  project.activity = 'outline'
  let page = renderStage('script', project, { beginImage: () => assert.fail('must not generate while busy') }, {})
  for (const button of page.querySelectorAll('.card-image-generate')) { assert.equal(button.disabled, true);button.click() }
  project.activity = null
  page = renderStage('script', project, { beginImage: async () => { throw new Error('生图请求失败') } }, {})
  const button = page.querySelector('[aria-label="AI生图：旅人"]')
  button.click();await new Promise(resolve => setImmediate(resolve))
  assert.equal(button.disabled, false);assert.equal(button.textContent, 'AI生图')
  assert.match(page.querySelector('.character-error').textContent, /生图请求失败/)
})

for (const [itemId, name, kind, selector] of [['C01', '旅人', 'characters', '.character-card'], ['E01', '庭院', 'scenes', '.scene-card']]) {
  for (const action of ['confirm-image', 'discard-image']) {
    test(`${name} card previews its candidate and supports ${action} without leaving the list`, async t => {
      const project = setup(t), calls = []
      const item = project.plot[kind].items[0]
      item.image.content = { localPath: '/old.png' }
      project.pendingImages = { draft: { draftId: 'draft', itemId, name, previewUrl: '/candidate.png' } }
      const actions = { beginImage() {}, async reviewImage(...args) {
        calls.push(args)
        if (action === 'confirm-image') item.image.content = { localPath: '/candidate.png' }
        delete project.pendingImages.draft
      } }
      const page = renderStage('script', project, actions, {})
      const card = page.querySelector(selector)
      assert.equal(card.querySelector('img').getAttribute('src'), '/candidate.png')
      assert.deepEqual([...card.querySelectorAll('.detail-image-buttons button')].map(button => button.textContent), ['放弃', '确定'])
      assert.equal(card.querySelector('.card-image-generate'), null)
      assert.equal(page.querySelector('.image-review-overlay'), null)
      const button = [...card.querySelectorAll('.detail-image-buttons button')].find(button => button.textContent === (action === 'confirm-image' ? '确定' : '放弃'))
      button.click(); button.click(); await new Promise(resolve => setImmediate(resolve))
      assert.equal(calls.length, 1)
      assert.deepEqual(calls[0].slice(1), [project.episodeId, 'draft', action])
      const updated = renderStage('script', project, actions, {}).querySelector(selector)
      assert.equal(updated.querySelector('img').getAttribute('src'), action === 'confirm-image' ? '/candidate.png' : '/old.png')
      assert.ok(updated.querySelector('.card-image-generate'))
      assert.equal(updated.querySelector('.detail-image-buttons'), null)
    })
  }
}

test('generating cards disable confirmation and discard until their own candidate is ready', t => {
  const project = setup(t)
  project.activity = 'image:C01'
  const page = renderStage('script', project, { beginImage() {}, reviewImage() { assert.fail('still generating') } }, {
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
  const page = renderStage('script', project, { async reviewImage() { throw new Error('保存图片失败') } }, {})
  const card = page.querySelector('.character-card')
  card.querySelector('.detail-image-buttons .primary').click()
  assert.ok([...card.querySelectorAll('.detail-image-buttons button')].every(button => button.disabled))
  await new Promise(resolve => setImmediate(resolve))
  assert.match(card.querySelector('.detail-image-error').textContent, /保存图片失败/)
  assert.ok([...card.querySelectorAll('.detail-image-buttons button')].every(button => !button.disabled))
  assert.equal(card.querySelector('img').getAttribute('src'), '/candidate.png')
})

test('session restores both card candidates and does not use another episode image gate', t => {
  const episode = setup(t)
  episode.pendingImages = {
    character: { draftId: 'character', itemId: 'C01', name: '旅人', previewUrl: '/character.png' },
    scene: { draftId: 'scene', itemId: 'E01', name: '庭院', previewUrl: '/scene.png' },
  }
  const root = { id: 'project', title: '剧', summary: { content: '' }, episodes: [episode] }
  const page = renderSession(root, () => {}, {}, { episodeId: episode.id, tab: 'script', imageGate: {
    itemId: 'C01', episodeId: 'other-episode', phase: 'ready', previewUrl: '/other.png', draftId: 'other',
  } })
  assert.equal(page.querySelector('.character-card img').getAttribute('src'), '/character.png')
  assert.equal(page.querySelector('.scene-card img').getAttribute('src'), '/scene.png')
  assert.equal(page.querySelectorAll('.card-image-review').length, 2)
  assert.equal(page.querySelector('.image-review-overlay'), null)
  assert.doesNotMatch(page.textContent, /图片任务请在详情页查看与确认/)
})

test('image details expose image history and their own basic skill beside generation controls', t => {
  const project = setup(t), calls = []
  const actions = { openHistory: (...args) => calls.push(['history', args[1]]), openSkill: (...args) => calls.push(['skill', args[1]]) }
  const character = renderCharacterDetail(project, 'C01', actions, {})
  const scene = renderSceneDetail(project, 'E01', actions, {})
  character.querySelector('.studio-tools .task-history-entry').click()
  character.querySelector('[aria-label="人物图片 skill"]').click()
  scene.querySelector('.task-history-entry').click()
  scene.querySelector('[aria-label="场景图片 skill"]').click()
  assert.equal(character.querySelector('.studio-parts'), null)
  assert.deepEqual(calls, [['history', 'images'], ['skill', 'character-image'], ['history', 'images'], ['skill', 'scene-image']])
  assert.ok(character.querySelector('[aria-label="AI生成"]'))
  assert.ok(scene.querySelector('.scene-image-tools .primary'))
})

test('character detail orders portrait, reference and a single generation toolbar', t => {
  const project = setup(t)
  project.plot.characters.items[0].image.content = { localPath: '/portrait.png' }
  project.plot.characters.items[0].reference = { localPath: '/reference.png' }
  const page = renderCharacterDetail(project, 'C01', { beginImage() {}, openHistory() {}, openSkill() {} }, {})
  const pair = page.querySelector('.studio-pair')
  assert.deepEqual([...pair.children].map(child => child.classList.contains('is-main') ? 'portrait' : child.classList.contains('is-reference') ? 'reference' : child.classList.contains('studio-tools') ? 'tools' : 'other'), ['portrait', 'reference', 'tools'])
  assert.equal(page.querySelectorAll('[aria-label="AI生成"]').length, 1)
  for (const label of ['AI生成', '画幅', '更换图片：旅人', '删除图片：旅人', '更换参考图：旅人', '移除参考图：旅人', '从素材库选择人物图片', '人物图片 skill']) assert.ok(page.querySelector(`[aria-label="${label}"]`).closest('.studio-tools'), label)
  assert.equal(pair.querySelector('.is-main img').getAttribute('src'), '/portrait.png')
  assert.equal(pair.querySelector('.is-reference img').getAttribute('src'), '/reference.png')
})

test('character detail generation is disabled while busy or reviewing and recovers after request failure', async t => {
  const project = setup(t)
  project.activity = 'image:C01'
  let page = renderCharacterDetail(project, 'C01', { beginImage() { assert.fail('busy') } }, {})
  assert.equal(page.querySelector('[aria-label="AI生成"]').disabled, true)
  project.activity = null
  page = renderCharacterDetail(project, 'C01', {}, { detailGate: { itemId: 'C01', episodeId: project.episodeId, phase: 'ready', previewUrl: '/draft.png', draftId: 'draft' } })
  assert.equal(page.querySelector('[aria-label="AI生成"]').disabled, true)
  assert.deepEqual([...page.querySelectorAll('.studio-tools .detail-image-buttons button')].map(button => button.textContent), ['放弃', '确定'])
  const calls = []
  page = renderCharacterDetail(project, 'C01', { async beginImage(...args) { calls.push(args); throw new Error('生图失败') } }, {})
  const generate = page.querySelector('[aria-label="AI生成"]')
  generate.click();generate.click()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.equal(generate.disabled, false)
  assert.equal(generate.textContent, 'AI生成')
  assert.match(page.textContent, /生图失败/)
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


test('props cards generate images by their independent P ID', async t => {
  const project = setup(t), calls = []
  project.plot.props.items = [{ id: 'P01', type: 'prop', name: '长衣', category: 'clothing', description: '灰色长衣', evidence: '旅人身穿灰色长衣', ownerId: 'C01' }]
  const page = renderStage('script', project, { fail() {}, beginImage: async (...args) => calls.push(args), openSkill: (...args) => calls.push(args) }, {})
  page.querySelector('[aria-label="道具图片 skill"]').click()
  assert.equal(calls[0][1], 'part-image')
  const button = [...page.querySelectorAll('.story-asset button')].find(b => b.textContent === 'AI生图')
  assert.ok(button); button.click(); await Promise.resolve()
  assert.equal(calls[1][1], 'image'); assert.equal(calls[1][2].itemId, 'P01')
  assert.match(page.textContent, /旅人身穿灰色长衣/)
})

test('prop card deletion sits beside its title, submits once and displays errors', async t => {
  const project = setup(t), calls = []
  project.plot.props.items = [{ id: 'P01', type: 'prop', name: '旧信', category: 'prop', description: '泛黄旧信', evidence: '旅人拿着旧信' }]
  let reject
  const page = renderStage('script', project, { perform: (...args) => {
    calls.push(args)
    return new Promise((resolve, failed) => { reject = failed })
  } }, {})
  const remove = page.querySelector('[aria-label="删除道具：旧信"]')
  assert.ok(remove.closest('.workflow-generation-row').querySelector('h3'))
  assert.equal(page.querySelector('[aria-label="删除道具：旅人"]'), null)
  remove.click(); remove.click()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'prop-delete')
  assert.deepEqual(calls[0][2], { itemId: 'P01', itemName: '旧信' })
  assert.equal(remove.disabled, true)
  reject(new Error('保存失败'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(remove.disabled, false)
  assert.match(page.textContent, /保存失败/)
})

test('prop deletion is disabled while a production task is running', t => {
  const project = setup(t)
  project.plot.props.items = [{ id: 'P01', type: 'prop', name: '旧信' }]
  project.activity = 'outline'
  const page = renderStage('script', project, { perform: () => assert.fail('must not delete while busy') }, {})
  const remove = page.querySelector('[aria-label="删除道具：旧信"]')
  assert.equal(remove.disabled, true)
  remove.click()
})
