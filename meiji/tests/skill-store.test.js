import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, tempHome } from './fixtures/model.js'
import { loadSkillSet, skillStore, additionsPatch } from '../server/data/skill-store.js'
import { builtinSkill } from '../skills/load-skills.js'

test('基础生产规则只读，旧审核覆盖不再参与新任务', async t => {
  const home = await tempHome(t), store = skillStore(home)
  await assert.rejects(store.save('shots', { generate: '改写' }), /不可编辑/)
  await assert.rejects(store.save('shots', { review: '旧审核' }), /不可编辑/)
  assert.throws(() => additionsPatch({}, 'shots', { review: '旧补充' }), /不可补充/)
  const set = await loadSkillSet(home, { additions: { shots: { review: '旧审核', generate: '旧基础' } } })
  assert.deepEqual(set.project.additions.shots, undefined)
  assert.equal(set.skills.shots.constraints, builtinSkill('shots').constraints)
  // 自审使用内置审核 skill（review/），旧的审核覆盖与补充不会替换它。
  assert.equal(set.skills.shots.review, builtinSkill('shots').review)
  assert.equal(set.skills.shots.parts.review, builtinSkill('shots').review)
  assert.doesNotMatch(set.skills.shots.review, /旧审核/)
})

test('skill HTTP endpoints: library, detail, confirmed base save, reset and preview', async t => {
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
  const call = async (method, path, body, headers = { 'x-meiji-request': '1' }) => {
    let status, value
    await handler({ url: '/plugins/meiji/' + path, method, headers, async *[Symbol.asyncIterator]() { if (body) yield JSON.stringify(body) } }, {
      writeHead(code) { status = code }, end(text) { value = JSON.parse(text) },
    })
    return { status, ...value }
  }
  const scope = { projectId: e.id, sessionId, episodeId: e.episodeId, nodeKey: 'characters' }
  const supplement = await call('PUT', 'node-skills', { ...scope, content: 'NODE_ONLY' })
  assert.equal(supplement.status, 200)
  assert.equal(supplement.items.length, 1)
  assert.doesNotMatch(supplement.skill.constraints, /### 场景卡/)
  assert.equal((await call('PUT', 'node-skills', { ...scope, content: 'x' }, {})).status, 403)
  assert.ok((await call('PUT', 'node-skills', { ...scope, sessionId: 'wrong', content: 'x' })).status >= 400)
  const nodePreview = await call('POST', 'skills/outline/preview', scope)
  assert.deepEqual(Object.keys(nodePreview.requests), ['generate', 'modify', 'review', 'revise'])
  assert.match(JSON.stringify(nodePreview.requests.generate), /NODE_ONLY/)
  assert.equal((await call('DELETE', 'node-skills', { ...scope, id: supplement.items[0].id })).items.length, 0)
  const fullText = '字'.repeat(10000)
  const replaced = await call('PUT', 'node-skills', { ...scope, content: fullText, replace: true })
  assert.equal(replaced.status, 200)
  assert.equal(replaced.items.length, 1)
  assert.equal(replaced.items[0].content, fullText)
  const cleared = await call('PUT', 'node-skills', { ...scope, content: '', replace: true })
  assert.equal(cleared.status, 200)
  assert.deepEqual(cleared.items, [])
  const library = await call('GET', 'skills')
  assert.equal(library.status, 200)
  assert.equal(library.skills.length, 11)
  assert.ok(library.skills.every(skill => skill.id !== 'text-shot'))
  assert.ok(library.skills.every(skill => skill.id !== 'image-prompt'))
  const detail = await call('GET', `skills/storyboard?projectId=${e.id}&sessionId=${sessionId}`)
  assert.deepEqual(detail.skill.fields.map(field => field.field), [])
  assert.match(detail.skill.protocol, /opening-reference/)
  assert.deepEqual(detail.skill.guidance.map(item => item.name), [])
  assert.deepEqual(detail.project.enabled, [])
  assert.equal((await call('GET', `skills/storyboard?projectId=${e.id}&sessionId=wrong`)).status >= 400, true)
  assert.equal((await call('PUT', 'skills/storyboard', { fields: { review: '改' } })).status, 400, '须确认对所有剧生效')
  assert.equal((await call('PUT', 'skills/storyboard', { fields: { review: '改' }, confirm: true }, {})).status, 403)
  assert.equal((await call('PUT', 'skills/storyboard', { fields: { review: '全局验收' }, confirm: true })).status, 400)
  const preview = await call('POST', 'skills/storyboard/preview', { projectId: e.id, sessionId, episodeId: e.episodeId, mode: 'text' })
  assert.equal(preview.status, 200)
  assert.deepEqual(Object.keys(preview.requests), ['generate', 'modify', 'review', 'revise'])
  assert.equal(preview.requests.review,null)
  assert.equal(preview.requests.revise,null)
  assert.match(preview.requests.generate.user[0].title,/程序组装/)
  const reset = await call('POST', 'skills/storyboard/reset', { to: 'builtin' })
  assert.deepEqual(reset.skill.fields, [])
  assert.equal((await call('POST', 'skills/guidance-action/preview', {})).status, 404)
  const image = await call('POST', 'skills/character-image/preview', {})
  assert.ok(image.requests.image.user.length)
  const fixed = await call('GET', 'skills/character-image')
  assert.deepEqual(fixed.skill.fields, [])
  assert.equal(fixed.skill.constraints, builtinSkill('character-image').constraints)
  for (const field of ['constraints', 'generate']) {
    assert.equal((await call('PUT', 'skills/character-image', { fields: { [field]: '不能修改' }, confirm: true })).status, 400)
    assert.equal((await call('POST', 'skills/character-image/reset', { field, to: 'previous' })).status, 400)
    assert.equal((await call('PUT', 'project-skills', { projectId: e.id, sessionId, skill: 'character-image', fields: { [field]: '不能补充' } })).status, 400)
  }
  assert.equal((await call('GET', 'skills/unknown')).status, 404)
  assert.equal((await call('GET', 'skills/text-shot')).status, 404)
  assert.equal((await call('POST', 'skills/text-shot/preview', {})).status, 404)
  assert.equal((await call('GET', `node-skills?projectId=${e.id}&sessionId=${sessionId}&episodeId=${e.episodeId}&nodeKey=text-shot:S01`)).status, 400)
})
