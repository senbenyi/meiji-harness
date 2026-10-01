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

test('character and scene lists only open detail and never generate or import images', t => {
  const project = setup(t), opened = []
  const page = renderStage('script', project, { fail() {} }, {
    onOpenCharacter: (...args) => opened.push(args), onOpenScene: (...args) => opened.push(args),
  })
  assert.equal(page.querySelector('.character-refresh'), null)
  assert.equal(page.querySelector('.asset-placeholder'), null)
  assert.equal(page.querySelector('.asset-actions'), null)
  assert.equal([...page.querySelectorAll('button')].some(button => /AI生图|文字生图|参考图生图/.test(button.textContent)), false)
  page.querySelector('[aria-label="人物详情：旅人"]').click()
  page.querySelector('[aria-label="场景详情：庭院"]').click()
  assert.deepEqual(opened, [[project.episodeId, 'C01'], [project.episodeId, 'E01']])
})

test('image details expose image history and their own basic skill beside generation controls', t => {
  const project = setup(t), calls = []
  const actions = { openHistory: (...args) => calls.push(['history', args[1]]), openSkill: (...args) => calls.push(['skill', args[1]]) }
  const character = renderCharacterDetail(project, 'C01', actions, {})
  const scene = renderSceneDetail(project, 'E01', actions, {})
  character.querySelector('.studio-toolbar .task-history-entry').click()
  character.querySelector('[aria-label="人物图片 skill"]').click()
  scene.querySelector('.task-history-entry').click()
  scene.querySelector('[aria-label="场景图片 skill"]').click()
  character.querySelector('[aria-label="附属素材 skill"]').click()
  assert.deepEqual(calls, [['history', 'images'], ['skill', 'character-image'], ['history', 'images'], ['skill', 'scene-image'], ['skill', 'part-image']])
  assert.ok(character.querySelector('[aria-label="文字生图"]'))
  assert.ok(scene.querySelector('.workflow-generation-row .primary'))
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
