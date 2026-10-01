import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { textShotFixture, storyboardFixture } from './fixtures/storyboard.js'
import { generateShotStoryboard } from '../server/generate/shot-text.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore } from '../server/data/task-store.js'
import { h3PromptFailures } from '../server/generate/film.js'
import { filmSubmit } from '../server/flow/operations/films.js'
import { nodeSkills, nodeSkillsPatch } from '../server/data/node-skills.js'
import { buildTextShotPrompts, buildStoryboardPrompts } from '../server/prompts/shot-prompts.js'

test('text generation and binding are separate requests; binding uses only approved text and frozen pictures', async () => {
  const project = episodeFixture(), requests = []
  project.shots.items[0].cast = ['C01']; project.shots.items[0].scene = 'E01'
  project.plot.characters.items[0].image.content = { localPath: '/portrait.png' }
  project.plot.scenes.items[0].image.content = { localPath: '/scene.png' }
  const rows = await generateShotStoryboard({ project, shotId: 'S01', request: async message => {
    requests.push(message)
    if (message.skill === 'review') return 'PASS'
    return message.skill === 'text-shot' ? textShotFixture() : storyboardFixture(message.user)
  } })
  assert.deepEqual(requests.map(m => m.skill), ['text-shot', 'review', 'storyboard', 'review'])
  assert.doesNotMatch(requests[0].user, /<Picture|base64|portrait.png/)
  assert.match(requests[2].user, /本镜已通过文本镜头/)
  assert.doesNotMatch(requests[2].user, /本集摘要|每秒指令|portrait.png/)
  const item = rows[0]
  assert.equal(item.textShot, textShotFixture())
  assert.deepEqual(item.characterIds, ['C01']); assert.deepEqual(item.sceneIds, ['E01'])
  assert.deepEqual(item.referenceSnapshot.map(r => r.url), ['/portrait.png', '/scene.png'])
  assert.deepEqual(h3PromptFailures(item.prompt.text, item.referenceSnapshot, item.video), [])
})

test('format check drives binding correction even when AI returns PASS', async () => {
  const project = episodeFixture(); project.plot.characters.items[0].image.content = { localPath: '/portrait.png' }
  let bindings = 0
  const rows = await generateShotStoryboard({ project, shotId: 'S01', request: async ({ skill, user }) => {
    if (skill === 'review') return 'PASS'
    if (skill === 'text-shot') return textShotFixture()
    if (++bindings === 1) return 'integrated_multimodal_description: 未绑定图片\noverall_soundscape: 风\nnon_diegetic_music: N/A'
    assert.match(user, /H3 reference/)
    return storyboardFixture(user)
  } })
  assert.equal(bindings, 2); assert.equal(rows[0].bindingCheck.passed, true)
})

test('binding-only keeps text verbatim and reads current selected images', async () => {
  const project = episodeFixture(), shot = project.shots.items[0]
  shot.storyboard.content.textShot = textShotFixture(); shot.storyboard.content.textShotCheck = { passed: true, failures: [] }
  shot.storyboard.content.textShotSecondsRevision = shot.seconds.revision
  project.plot.characters.items[0].image.content = { localPath: '/new-portrait.png' }
  const rows = await generateShotStoryboard({ project, shotId: 'S01', bindingOnly: true, request: async ({ skill, user }) => {
    assert.notEqual(skill, 'text-shot')
    return skill === 'review' ? 'PASS' : storyboardFixture(user)
  } })
  assert.equal(rows[0].textShot, textShotFixture()); assert.equal(rows[0].referenceSnapshot[0].url, '/new-portrait.png')
  shot.seconds.revision++
  await assert.rejects(generateShotStoryboard({ project, shotId: 'S01', bindingOnly: true }), /当前每秒指令/)
})

test('failed binding saves approved text and failed final prompt, and task does not pass', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('shot-storyboard', { track: 'S01' }), { home: e.home, operationId: 'bad-binding',
    generateShotStoryboard: opts => generateShotStoryboard({ ...opts, request: async ({ skill }) => skill === 'review' ? 'PASS' : skill === 'text-shot' ? textShotFixture() : '错误引用稿' }) }), /自检未通过/)
  const board = (await e.read()).shots.items[0].storyboard
  assert.equal(board.content.textShotCheck.passed, true)
  assert.equal(board.content.prompt.text, '错误引用稿')
  assert.equal(board.check.passed, false)
  const task = await recordStore(e.home, e.id).read('tasks', 'bad-binding')
  assert.equal(task.status, 'review_failed')
  assert.ok(task.steps.every(step => !step.unplanned))
  assert.equal(task.steps.find(s => s.phase === 'reference-binding' && s.kind === 're_review').verdict, 'fail')
})

test('editing text invalidates only target binding and supports a later binding-only task', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, p => {
    const s = p.episodes[0].shots.items[0]
    Object.assign(s.storyboard.content, { textShot: textShotFixture(), textShotCheck: { passed: true, failures: [] }, textShotSecondsRevision: s.seconds.revision })
    return p
  })
  const before = await e.read(), revised = textShotFixture().replace('风声', '持续风声')
  await runOperation(e.op('text-shot-edit', { track: 'S01', text: revised, originalText: textShotFixture() }), { home: e.home, reviewContent: async () => ({ passed: true, failures: [] }) })
  const saved = await e.read()
  assert.equal(saved.shots.items[0].storyboard.content.textShot, revised)
  assert.equal(saved.shots.items[0].storyboard.content.prompt.text, '')
  assert.deepEqual(saved.shots.items[1], before.shots.items[1])
  await runOperation(e.op('storyboard-bind', { track: 'S01' }), { home: e.home, operationId: 'binding-only',
    generateShotStoryboard: opts => generateShotStoryboard({ ...opts, request: async ({ skill, user }) => {
      assert.notEqual(skill, 'text-shot'); return skill === 'review' ? 'PASS' : storyboardFixture(user)
    } }) })
  assert.equal((await e.read()).shots.items[0].storyboard.content.textShot, revised)
  const task = await recordStore(e.home, e.id).read('tasks', 'binding-only')
  assert.equal(task.status, 'completed'); assert.ok(task.steps.every(s => s.phase === 'reference-binding' && !s.unplanned))
})

test('format:text cannot bypass reference structure validation before video submission', () => {
  const project = episodeFixture()
  const item = { ...project.shots.items[0].storyboard.content, id: 'S01', video: 'reference', referenceSnapshot: [{ url: '/portrait.png' }] }
  assert.throws(() => filmSubmit(project, item, {}), /H3 reference/)
})

test('two phases use separate node supplements within the current episode and shot', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, p => nodeSkillsPatch(p, { episodeId: e.episodeId, nodeKey: 'text-shot:S01', content: '文字阶段补充' }))
  const root = await e.store.save(e.id, p => nodeSkillsPatch(p, { episodeId: e.episodeId, nodeKey: 'storyboard:S01', content: '引用阶段补充' }))
  assert.equal(nodeSkills(root, e.episodeId, 'text-shot:S02').length, 0)
  const project = await e.read(), shot = project.shots.items[0]
  const text = buildTextShotPrompts({ project, shotId: 'S01' }, shot).generation.system
  const binding = buildStoryboardPrompts({ project, shotId: 'S01' }, { shot, video: 'text', characters: [], scenes: [], images: [], refs: '', textShot: textShotFixture() }).generation.system
  assert.match(text, /文字阶段补充/); assert.doesNotMatch(text, /引用阶段补充/)
  assert.match(binding, /引用阶段补充/); assert.doesNotMatch(binding, /文字阶段补充/)
})

test('Subject N1 placeholder numbering is rejected with an actionable correction', () => {
  const prompt = storyboardFixture('<Picture 1> 旅人').replaceAll('<Subject 1>', '<Subject N1>')
  assert.match(h3PromptFailures(prompt, [{}], 'reference').join('\n'), /不能写 <Subject N1>/)
})
