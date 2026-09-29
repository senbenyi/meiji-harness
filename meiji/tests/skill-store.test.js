import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel, tempHome } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { loadSkillSet, skillStore, skillsRoot } from '../server/data/skill-store.js'
import { builtinSkill, textHash } from '../skills/load.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore } from '../server/data/task-store.js'
import { generateEpisode } from '../server/generate/story.js'
import { additionsPatch } from '../server/data/skill-store.js'

test('base edits replace built-in fields, keep one previous version, and restore', async t => {
  const home = await tempHome(t), store = skillStore(home)
  const builtin = builtinSkill('shots').parts.review
  let skill = await store.save('shots', { review: '基础审核 v1' })
  assert.equal(skill.parts.review, '基础审核 v1')
  assert.equal(skill.layers.review, 'base')
  assert.equal(skill.layers.generate, 'builtin')
  const stored = JSON.parse(await readFile(join(skillsRoot(home), 'shots.json'), 'utf8'))
  assert.deepEqual(stored.fields.review, { text: '基础审核 v1', hash: textHash('基础审核 v1'), builtinHash: textHash(builtin) })
  assert.deepEqual(stored.previous.review, { builtin: true })
  assert.equal(Object.keys(stored.fields).length, 1, '只存改过的字段')
  skill = await store.save('shots', { review: '基础审核 v2' })
  skill = await store.reset('shots', { to: 'previous', field: 'review' })
  assert.equal(skill.parts.review, '基础审核 v1')
  skill = await store.reset('shots', { to: 'builtin', field: 'review' })
  assert.equal(skill.parts.review, builtin)
  assert.equal(skill.layers.review, 'builtin')
  skill = await store.reset('shots', { to: 'previous', field: 'review' })
  assert.equal(skill.parts.review, '基础审核 v1')
  // 与内置相同即视为恢复内置
  skill = await store.save('shots', { review: builtin })
  assert.equal(skill.layers.review, 'builtin')
  await assert.rejects(store.save('shots', { protocol: 'x' }), /不可编辑/)
  await assert.rejects(store.save('nope', { generate: 'x' }), /技能不存在/)
  await assert.rejects(store.save('shots', { generate: 'x'.repeat(60001) }), /60000/)
  assert.deepEqual((await readdir(skillsRoot(home))).filter(name => name.endsWith('.tmp')), [])
})

test('a built-in update after a base edit is flagged for comparison', async t => {
  const home = await tempHome(t), store = skillStore(home)
  await store.save('guidance-martial', { common: '本地武术' })
  const file = join(skillsRoot(home), 'guidance-martial.json')
  const stored = JSON.parse(await readFile(file, 'utf8'))
  stored.fields.common.builtinHash = 'older-builtin'
  await (await import('node:fs/promises')).writeFile(file, JSON.stringify(stored))
  const skill = await store.get('guidance-martial')
  assert.deepEqual(skill.outdated, ['common'])
  assert.equal(skill.builtin.common, builtinSkill('guidance-martial').parts.common)
  const listed = (await store.list()).find(item => item.id === 'guidance-martial')
  assert.deepEqual(listed.outdated, ['common'])
})

test('a task fixes base and drama skills at its start; later edits do not change its requests', async t => {
  const e = await setupModel(t), models = modelStore(e.home)
  await models.write({ ...await models.read(), apiKey: 'test-only' })
  await skillStore(e.home).save('episode', { review: '【基础】第一版验收' })
  await e.store.save(e.id, current => ({ skills: additionsPatch(current.skills, 'episode', { generate: '本剧第一版' }) }))
  const seen = []
  await runOperation(e.op('episode-generate'), { home: e.home, generateEpisode: options => generateEpisode({ ...options, request: async message => {
    seen.push(message.system + message.user)
    if (message.skill !== 'review') {
      await skillStore(e.home).save('episode', { review: '【基础】第二版验收' })
      await e.store.save(e.id, current => ({ skills: additionsPatch(current.skills, 'episode', { generate: '本剧第二版' }) }))
      return JSON.stringify({ summary: '初稿', durationSeconds: 10 })
    }
    return 'PASS'
  } }) })
  assert.equal(seen.length, 2)
  for (const text of seen) {
    assert.match(text, /第一版/)
    assert.doesNotMatch(text, /第二版/)
  }
  const [task] = await recordStore(e.home, e.id).list()
  assert.deepEqual(task.skills.map(skill => [skill.id, skill.layers]), [['episode', ['builtin', 'base', 'project']]])
  assert.match(task.skills[0].hash, /^[0-9a-f]{12}$/)
  const next = await loadSkillSet(e.home, (await e.store.read(e.id)).skills)
  assert.match(next.skills.episode.parts.review, /第二版/)
})

test('skill HTTP endpoints: library, detail, confirmed base save, reset and preview', async t => {
  const { registerPanel } = await import('../server/http/routes.js')
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
  const library = await call('GET', 'skills')
  assert.equal(library.status, 200)
  assert.equal(library.skills.length, 23)
  const detail = await call('GET', `skills/storyboard?projectId=${e.id}&sessionId=${sessionId}`)
  assert.deepEqual(detail.skill.fields.map(field => field.field), ['common', 'generate', 'review', 'revise'])
  assert.match(detail.skill.protocol, /opening-reference/)
  assert.deepEqual(detail.skill.guidance.map(item => item.name), ['action', 'martial', 'dialogue', 'expression', 'sound'])
  assert.deepEqual(detail.project.enabled, ['action', 'dialogue', 'expression', 'sound'])
  assert.equal((await call('GET', `skills/storyboard?projectId=${e.id}&sessionId=wrong`)).status >= 400, true)
  assert.equal((await call('PUT', 'skills/storyboard', { fields: { review: '改' } })).status, 400, '须确认对所有剧生效')
  assert.equal((await call('PUT', 'skills/storyboard', { fields: { review: '改' }, confirm: true }, {})).status, 403)
  const saved = await call('PUT', 'skills/storyboard', { fields: { review: '全局验收' }, confirm: true })
  assert.equal(saved.skill.fields.find(field => field.field === 'review').layer, 'base')
  assert.deepEqual((await call('GET', 'skills')).skills.find(skill => skill.id === 'storyboard').modified, ['review'])
  const preview = await call('POST', 'skills/storyboard/preview', { projectId: e.id, sessionId, episodeId: e.episodeId, mode: 'text' })
  assert.equal(preview.status, 200)
  assert.deepEqual(Object.keys(preview.requests), ['generate', 'modify', 'review', 'revise'])
  assert.ok(preview.requests.review.user.some(segment => segment.text.includes('全局验收')))
  assert.ok(preview.requests.generate.system.some(segment => segment.source === 'reference'))
  assert.ok(!preview.requests.review.system.some(segment => segment.source === 'reference'))
  assert.ok(preview.requests.generate.chars > 1000)
  const reset = await call('POST', 'skills/storyboard/reset', { to: 'builtin' })
  assert.equal(reset.skill.fields.find(field => field.field === 'review').layer, 'builtin')
  assert.equal((await call('POST', 'skills/guidance-action/preview', {})).status, 400)
  const image = await call('POST', 'skills/character-image/preview', {})
  assert.ok(image.requests.image.user.length)
  assert.equal((await call('GET', 'skills/unknown')).status, 404)
})
