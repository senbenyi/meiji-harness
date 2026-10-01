import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { episodeFixture } from './fixtures/model.js'
import { textShotFixture } from './fixtures/storyboard.js'
import { textShotView } from '../client/text-shot-view.js'

test('text shot view exposes scoped skills, binding-only action and independent text editing', async t => {
  const dom = new JSDOM('<body></body>'), before = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = before; dom.window.close() })
  const project = episodeFixture(), calls = [], skills = []
  const story = { id: 'S01', textShot: textShotFixture(), textShotCheck: { passed: true } }
  const view = textShotView(project, story, { perform: async (_project, action, fields) => calls.push({ action, ...fields }), openNodeSkill: (_project, nodeKey, skill) => skills.push([nodeKey, skill]) })
  dom.window.document.body.append(view)
  const button = text => [...view.querySelectorAll('button')].find(b => b.textContent === text)
  button('查看 skill').click(); button('查看引用 skill').click()
  assert.deepEqual(skills, [['text-shot:S01', 'text-shot'], ['storyboard:S01', 'storyboard']])
  await button('重新编排引用').onclick()
  assert.deepEqual(calls[0], { action: 'storyboard-bind', track: 'S01' })
  button('编辑文本镜头').click()
  assert.equal(view.querySelector('form').hidden, false)
  view.querySelector('textarea').value = '新的文字'
  await view.querySelector('form').onsubmit({ preventDefault() {} })
  assert.deepEqual(calls[1], { action: 'text-shot-edit', track: 'S01', text: '新的文字', originalText: textShotFixture() })
})
