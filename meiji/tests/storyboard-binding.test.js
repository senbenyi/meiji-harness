import { reviewPass } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { storyboardFixture } from './fixtures/storyboard.js'
import { generateShotStoryboard } from '../server/generate/shot-text.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore } from '../server/data/task-store.js'
import { h3PromptFailures } from '../server/generate/film.js'
import { filmSubmit } from '../server/flow/operations/films.js'
import { nodeSkills, nodeSkillsPatch } from '../server/data/node-skills.js'
import { buildStoryboardPrompts } from '../server/prompts/shot-prompts.js'
import { buildEditedContentReview } from '../server/prompts/text-prompts.js'
import { TextStoryboardModel } from '../server/prompts/models/text-storyboard-model.js'
import { render } from '../server/prompts/skill-prompts.js'
import { builtinSkill, isSkill } from '../skills/load.js'
import { textInterface } from '../server/prompts/interfaces/registry.js'

test('binding reads approved seconds directly in one phase and freezes pictures', async () => {
  const project = episodeFixture(), requests = []
  project.shots.items[0].cast = ['C01']; project.shots.items[0].scene = 'E01'
  project.plot.characters.items[0].image.content = { localPath: '/portrait.png' }
  project.plot.scenes.items[0].image.content = { localPath: '/scene.png' }
  const rows = await generateShotStoryboard({ project, shotId: 'S01', request: async message => {
    requests.push(message)
    if (message.skill === 'review') return reviewPass
    return storyboardFixture(message.user)
  } })
  assert.deepEqual(requests.map(m => m.skill), ['storyboard', 'review'])
  assert.match(requests[0].user, /本镜已通过每秒指令（唯一时间线来源）/)
  assert.match(requests[0].user, /0–5s：旅人朝北行走，摄影机位于身后。/)
  assert.match(requests[0].system, /最后一段的交接写成本镜结尾状态/)
  assert.doesNotMatch(requests[0].user, /本集摘要|大纲|前镜|后镜/)
  assert.doesNotMatch(requests[1].user, /完整镜头表|前一镜.*最终文本分镜/)
  assert.doesNotMatch(requests[0].user, /portrait.png|base64/)
  const item = rows[0]
  assert.equal(item.textShot, undefined)
  assert.equal(item.secondsRevision, project.shots.items[0].seconds.revision)
  assert.deepEqual(item.characterIds, ['C01']); assert.deepEqual(item.sceneIds, ['E01'])
  assert.deepEqual(item.referenceSnapshot.map(r => r.url), ['/portrait.png', '/scene.png'])
  assert.deepEqual(h3PromptFailures(item.prompt.text, item.referenceSnapshot, item.video), [])
})

test('unselected scenes are matched by card ID mentioned in the seconds', async () => {
  const project = episodeFixture(), shot = project.shots.items[0]
  shot.cast = []; shot.scene = ''
  shot.seconds.content = '0–5s：旅人（C01）在 E01 主走道朝北行走，摄影机位于身后。'
  project.plot.scenes.items[0].image.content = { localPath: '/scene.png' }
  const rows = await generateShotStoryboard({ project, shotId: 'S01', request: async ({ skill, user }) => skill === 'review' ? reviewPass : storyboardFixture(user) })
  assert.deepEqual(rows[0].sceneIds, ['E01'])
  assert.deepEqual(rows[0].referenceSnapshot.map(r => r.url), ['/scene.png'])
})

test('format check drives binding correction even when AI returns PASS', async () => {
  const project = episodeFixture(); project.plot.characters.items[0].image.content = { localPath: '/portrait.png' }
  let bindings = 0
  const rows = await generateShotStoryboard({ project, shotId: 'S01', request: async ({ skill, user }) => {
    if (skill === 'review') return reviewPass
    if (++bindings === 1) return 'integrated_multimodal_description: 未绑定图片\noverall_soundscape: 风\nnon_diegetic_music: N/A'
    assert.match(user, /H3 reference/)
    return storyboardFixture(user)
  } })
  assert.equal(bindings, 2); assert.equal(rows[0].bindingCheck.passed, true)
})

test('rebinding reads current seconds and current selected images', async () => {
  const project = episodeFixture(), shot = project.shots.items[0]
  project.plot.characters.items[0].image.content = { localPath: '/new-portrait.png' }
  shot.seconds.content = '0–5s：旅人改为朝东行走，摄影机位于左侧。'
  let user = ''
  const rows = await generateShotStoryboard({ project, shotId: 'S01', request: async message => {
    if (message.skill !== 'review') user = message.user
    return message.skill === 'review' ? reviewPass : storyboardFixture(message.user)
  } })
  assert.match(user, /朝东行走，摄影机位于左侧/)
  assert.equal(rows[0].referenceSnapshot[0].url, '/new-portrait.png')
})

test('failed binding saves the failed final prompt, and task does not pass', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('shot-storyboard', { track: 'S01' }), { home: e.home, operationId: 'bad-binding',
    generateShotStoryboard: opts => generateShotStoryboard({ ...opts, request: async ({ skill }) => skill === 'review' ? reviewPass : '错误引用稿' }) }), /自检未通过/)
  const board = (await e.read()).shots.items[0].storyboard
  assert.equal(board.content.prompt.text, '错误引用稿')
  assert.equal(board.check.passed, false)
  const task = await recordStore(e.home, e.id).read('tasks', 'bad-binding')
  assert.equal(task.status, 'review_failed')
  assert.ok(task.steps.every(step => !step.unplanned))
  assert.equal(task.steps.find(s => s.phase === 'reference-binding' && s.kind === 're_review').verdict, 'fail')
})

test('shot storyboard and storyboard-bind plan only reference-binding steps', async t => {
  const e = await setupModel(t)
  for (const [action, id] of [['shot-storyboard', 'full'], ['storyboard-bind', 'rebind']]) {
    await runOperation(e.op(action, { track: 'S01' }), { home: e.home, operationId: id,
      generateShotStoryboard: opts => generateShotStoryboard({ ...opts, request: async ({ skill, user }) => {
        assert.notEqual(skill, 'text-shot'); return skill === 'review' ? reviewPass : storyboardFixture(user)
      } }) })
    const task = await recordStore(e.home, e.id).read('tasks', id)
    assert.equal(task.status, 'completed'); assert.ok(task.steps.every(s => s.phase === 'reference-binding' && !s.unplanned))
  }
  await assert.rejects(runOperation(e.op('text-shot-edit', { track: 'S01', text: '旧文本' }), { home: e.home }))
})

test('format:text cannot bypass reference structure validation before video submission', () => {
  const project = episodeFixture()
  const item = { ...project.shots.items[0].storyboard.content, id: 'S01', video: 'reference', referenceSnapshot: [{ url: '/portrait.png' }] }
  assert.throws(() => filmSubmit(project, item, {}), /H3 reference/)
})

test('storyboard node supplement reaches the binding request for its own shot only', async t => {
  const e = await setupModel(t)
  const root = await e.store.save(e.id, p => nodeSkillsPatch(p, { episodeId: e.episodeId, nodeKey: 'storyboard:S01', content: '引用阶段补充' }))
  assert.equal(nodeSkills(root, e.episodeId, 'storyboard:S02').length, 0)
  const project = await e.read(), shot = project.shots.items[0]
  const binding = buildStoryboardPrompts({ project, shotId: 'S01' }, { shot, video: 'text', characters: [], scenes: [], images: [], refs: '' }).generation.system
  assert.match(binding, /引用阶段补充/)
})

test('Subject N1 placeholder numbering is rejected with an actionable correction', () => {
  const prompt = storyboardFixture('<Picture 1> 旅人').replaceAll('<Subject 1>', '<Subject N1>')
  assert.match(h3PromptFailures(prompt, [{}], 'reference').join('\n'), /不能写 <Subject N1>/)
})

test('conversion has one compact base skill and mode-specific structures in all three requests', () => {
  const rules = builtinSkill('storyboard').constraints
  assert.ok(rules.length < 1500)
  assert.doesNotMatch(rules, /招式服从|台词服务|表情来自|first_frame|本次生成语言|请根据/)
  for (const mode of ['text', 'reference']) {
    const model = new TextStoryboardModel({ mode, shotId: 'S01', project: { outputLanguage: 'en' }, instructions: 'APPROVED_SECONDS' })
    for (const segments of [model.toGenerateSegments(), model.toReviewSegments('LATEST'), model.toReviseSegments('FAILED', 'FIX_BINDING')]) {
      const text = render(segments.system) + render(segments.user)
      assert.equal(text.split(rules).length - 1, 1)
      assert.match(text, /APPROVED_SECONDS/)
      assert.match(text, /本次生成语言：English/)
      assert.match(text, /overall_soundscape、non_diegetic_music/)
      assert.match(text, /<d> 内仅写对白语言标签与原文台词/)
      assert.match(text, /只有每秒指令已确定的实际剪辑/)
      assert.doesNotMatch(text, /标准返回样本|first_frame|通读整集/)
      if (mode === 'reference') assert.match(text, /subject_definitions、summary、retention_analysis、detailed_description/)
      else assert.match(text, /integrated_multimodal_description、overall_soundscape/)
    }
  }
})

test('generation revision and manual review share only the selected shot context and frozen picture order', () => {
  const project = episodeFixture(), shot = project.shots.items[0]
  project.episodeId = project.id
  project.summary.content = 'UNRELATED_SUMMARY'
  project.plot.outline.content = 'UNRELATED_OUTLINE'
  project.shots.items[1].seconds.content = 'OTHER_SECONDS'
  project.plot.characters.items.push({ id: 'C99', name: 'UNRELATED_PERSON', look: 'OTHER_APPEARANCE' })
  project.plot.scenes.items.push({ id: 'E99', name: 'UNRELATED_SCENE' })
  project.plot.scenes.items[0].landmark = '固定地标'
  const images = [{ label: '旅人', url: '/fixed-person.png', kind: 'characters' }, { label: '庭院', url: '/fixed-scene.png', kind: 'scenes' }]
  Object.assign(shot.storyboard.content, { video: 'reference', characterIds: ['C01'], sceneIds: ['E01'], referenceSnapshot: images })
  project.supplementalSkills = { 'storyboard:S01': [{ id: 'current', content: 'CURRENT_SUPPLEMENT' }], 'storyboard:S02': [{ id: 'other', content: 'OTHER_SUPPLEMENT' }] }
  const prompts = buildStoryboardPrompts({ project, shotId: 'S01' }, { shot, video: 'reference', characters: ['C01'], scenes: ['E01'], refs: '<Picture 1> 旅人\n<Picture 2> 庭院', images })
  const edited = buildEditedContentReview({ project, stage: 'storyboard', shotId: 'S01' }, 'EDITED')
  for (const request of [prompts.generation, prompts.review('LATEST'), prompts.revision('FAILED', 'FIX'), edited]) {
    const text = request.system + request.user
    assert.match(text, /CURRENT_SUPPLEMENT/)
    assert.match(text, /旅人朝北行走，摄影机位于身后/)
    assert.match(text, /固定地标/)
    assert.ok(text.indexOf('<Picture 1> 旅人') < text.indexOf('<Picture 2> 庭院'))
    assert.doesNotMatch(text, /UNRELATED_|OTHER_SECONDS|OTHER_SUPPLEMENT|OTHER_APPEARANCE|完整镜头表|跨镜连续性审核资料|fixed-person.png/)
  }
  assert.match(edited.system, /上游自身冲突应指出具体来源/)
  assert.match(edited.user, /只审核 S01 已编辑/)
})

test('retired text-shot skill and node are unavailable without deleting stored historical supplements', async t => {
  assert.equal(isSkill('text-shot'), false)
  assert.throws(() => textInterface('text-shot'), /未定义文本接口/)
  const e = await setupModel(t)
  const root = await e.store.save(e.id, p => ({ episodes: p.episodes.map(ep => ({ ...ep, supplementalSkills: { ...ep.supplementalSkills, 'text-shot:S01': [{ id: 'old', content: 'HISTORICAL_SUPPLEMENT' }] } })) }))
  assert.throws(() => nodeSkills(root, e.episodeId, 'text-shot:S01'), /节点不存在/)
  assert.equal(root.episodes[0].supplementalSkills['text-shot:S01'][0].content, 'HISTORICAL_SUPPLEMENT')
})
