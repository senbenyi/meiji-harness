import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { StoryOutlineModel } from '../server/prompts/models/story-outline-model.js'
import { StoryCharacterModel } from '../server/prompts/models/story-character-model.js'
import { StorySceneModel } from '../server/prompts/models/story-scene-model.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { generateStoryPackage } from '../server/generate/story.js'
import { checkContext } from '../server/data/operation-context.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { storyPackageFixture, outlineFixture } from './fixtures/story-package.js'
import { definitions } from '../server/flow/operations/registry.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordSteps } from './fixtures/steps.js'
import { builtinSkill } from '../skills/load.js'

for (const [Model, kind] of [[StoryOutlineModel, 'outline'], [StoryCharacterModel, 'characters'], [StorySceneModel, 'scenes']]) {
  test(`${kind}: model independently assembles generation, revision and review`, () => {
    const model = new Model({ project: episodeFixture(), mode: 'modify', baseContent: 'BASE', opinion: 'HUMAN', generationRules: 'RULE' })
    const generated = model.toGenerateMessages()
    assert.deepEqual(generated.map(message => message.role), ['system', 'user'])
    assert.match(generated[0].content, kind === 'outline' ? /完整大纲纯文本/ : /顶层仅含 items/)
    const revised = model.toReviseMessages({ baseContent: 'LATEST', opinion: reviewFail('NEW'), automatic: true })
    assert.match(revised[1].content, /LATEST/)
    assert.match(revised[1].content, /HUMAN/)
    assert.doesNotMatch(revised[1].content, /BASE/)
    const reviewed = model.toReviewMessages({ content: 'RESULT' })
    assert.match(reviewed[0].content, /独立.*审核员/)
    assert.match(reviewed[0].content, /RULE/)
    assert.match(reviewed[1].content, /BASE/)
    assert.match(reviewed[1].content, /RESULT/)
    for (const automatic of [false, true]) {
      const review = model.toReviewMessages({ content: 'RESULT', automatic })
      assert.match(review[1].content, /只返回统一审核 JSON/)
      assert.doesNotMatch(review[1].content, /仅生成本集完整剧情大纲|返回人物 items|返回无人物的环境卡 items/)
      assert.doesNotMatch(review[0].content, /JSON 字符串里的换行正确转义/)
    }
    assert.doesNotMatch(generated[1].content, /只返回统一审核 JSON/)
    assert.doesNotMatch(revised[1].content, /只返回统一审核 JSON/)
  })
}

test('review returning an outline instead of a verdict fails and retains the generated draft', async () => {
  const draft = outlineFixture('生成稿')
  let calls = 0
  const saved = []
  await assert.rejects(generateStoryPackage({ project: episodeFixture(), request: async () =>
    ++calls === 1 ? draft : draft,
    persist: result => saved.push(structuredClone(result)),
  }), /审核返回格式错误/)
  assert.equal(calls, 2)
  assert.equal(saved.at(-1).outline, draft)
})

test('每个剧情步骤生成和审核共用同一基础规则，输出协议独立', () => {
  for (const [kind, generation, criteria, other] of [
    ['outline', '故事大纲', '大纲验收', '人物验收|场景验收'],
    ['characters', '角色卡', '人物验收', '大纲验收|场景验收'],
    ['scenes', '场景卡', '场景验收', '大纲验收|人物验收'],
  ]) {
    const prompts = buildStoryPrompts(episodeFixture(), kind)
    const rules = builtinSkill('outline').rules[kind]
    assert.ok(rules.trim())
    assert.ok(prompts.generation.system.includes(rules))
    assert.ok(prompts.review('DRAFT').system.includes(rules))
    assert.doesNotMatch(prompts.review('DRAFT').system, new RegExp(other))
    assert.doesNotMatch(prompts.generation.system, /【自检标准】|审核通用协议|一次调用、一次返回完整结果/)
    assert.doesNotMatch(prompts.review('DRAFT').system, /审核通用协议|独立审片师/)
  }
})

test('plan has distinct targets and a failed outline skips all extraction requests', async () => {
  assert.deepEqual(definitions.outline.plan().filter(step => step.kind === 'generate').map(step => step.target), ['outline', 'characters', 'scenes', 'props'])
  const replies = ['初稿', reviewFail('因果错误'), '修订稿', reviewFail('因果错误')]
  let calls = 0
  const { result, steps } = await recordSteps(() => generateStoryPackage({ project: episodeFixture(), request: async () => { calls++; return replies.shift() } }))
  assert.equal(calls, 4)
  assert.equal(result.outline, '修订稿')
  assert.equal(result.checks.characters.passed, null)
  assert.ok(result.characters.stale)
  assert.equal(result.check.passed, false)
  assert.ok(steps.every(step => step.target === 'outline'))
})

test('a card API error retains drafts saved by earlier independent stages', async () => {
  let calls = 0
  const saved = []
  await assert.rejects(generateStoryPackage({ project: episodeFixture(), request: async () => {
    if (++calls === 1) return outlineFixture('已生成大纲')
    if (calls === 2) return reviewPass
    throw new Error('CHARACTER_API_ERROR')
  }, persist: result => saved.push(structuredClone(result)) }), /CHARACTER_API_ERROR/)
  assert.equal(calls, 3)
  assert.equal(saved.at(-1).outline, outlineFixture('已生成大纲'))
  assert.equal(saved.at(-1).checks.outline.passed, true)
  assert.equal(saved.at(-1).checks.characters.passed, null)
})

test('extraction after outline modification uses new facts, never stale card bases or old opinions', async () => {
  const project = episodeFixture()
  project.plot.outline.content = 'OLD_OUTLINE'
  const fixture = storyPackageFixture()
  const replies = [outlineFixture('FINAL_NEW_OUTLINE'), reviewPass, JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify(fixture.props), reviewPass]
  let calls = 0
  await checkContext.run({ generationMode: 'modify', originalProject: project, review: 'CHANGE_OUTLINE' }, () => generateStoryPackage({ project, request: async message => {
    if (++calls === 1) assert.match(message.user, /OLD_OUTLINE.*|CHANGE_OUTLINE/)
    if (calls >= 3) {
      assert.match(message.user, /FINAL_NEW_OUTLINE/)
      assert.doesNotMatch(message.user, /OLD_OUTLINE|CHANGE_OUTLINE|修改基稿/)
    }
    return replies.shift()
  } }))
  assert.equal(calls, 8)
})

test('real operation persists independent checks and blocks downstream after failed characters', async t => {
  const e = await setupModel(t)
  const fixture = storyPackageFixture()
  const replies = [outlineFixture('FINAL_OUTLINE'), reviewPass, JSON.stringify(fixture.characters), reviewFail('缺少另一身体'), JSON.stringify(fixture.characters), reviewFail('缺少另一身体')]
  let calls = 0
  await runOperation(e.op('outline', { generationMode: 'regenerate' }), { home: e.home,
    generateStoryPackage: options => generateStoryPackage({ ...options, request: async () => { calls++; return replies.shift() } }),
  })
  const saved = await e.read()
  assert.equal(calls, 6)
  assert.equal(saved.plot.outline.content, outlineFixture('FINAL_OUTLINE'))
  assert.equal(saved.plot.outline.check.passed, true)
  assert.equal(saved.plot.characters.check.passed, false)
  assert.equal(saved.plot.scenes.check.passed, null)
  assert.equal(saved.plot.scenes.stale, true)
  assert.equal(saved.shots.items.length, 0)
})

test('a later API error preserves the passed outline status in the real operation', async t => {
  const e = await setupModel(t)
  let calls = 0
  await assert.rejects(runOperation(e.op('outline', { generationMode: 'regenerate' }), { home: e.home,
    generateStoryPackage: options => generateStoryPackage({ ...options, request: async () => {
      if (++calls === 1) return outlineFixture('PASSED_OUTLINE')
      if (calls === 2) return reviewPass
      throw new Error('CHARACTER_ERROR')
    } }),
  }), /CHARACTER_ERROR/)
  const saved = await e.read()
  assert.equal(saved.plot.outline.content, outlineFixture('PASSED_OUTLINE'))
  assert.equal(saved.plot.outline.check.passed, true)
  assert.equal(saved.plot.outline.status, 'passed')
  assert.equal(saved.plot.outline.operation, null)
  assert.equal(saved.plot.characters.check.passed, null)
  assert.equal(calls, 3)
})

test('stopping before the next stage prevents card API requests and keeps the outline draft', async () => {
  const controller = new AbortController()
  let calls = 0
  const saved = []
  await assert.rejects(generateStoryPackage({ project: episodeFixture(), signal: controller.signal, request: async () => {
    calls++
    return calls === 1 ? outlineFixture('NEW_OUTLINE') : reviewPass
  }, persist: result => {
    saved.push(structuredClone(result))
    if (result.checks.outline.passed) controller.abort()
  } }), { name: 'AbortError' })
  assert.equal(calls, 2)
  assert.equal(saved.at(-1).outline, outlineFixture('NEW_OUTLINE'))
  assert.equal(saved.at(-1).checks.outline.passed, true)
})

test('preview exposes all three models with the same prompt builders', async () => {
  const { previewPrompts } = await import('../server/prompts/preview.js')
  const { builtinSkillSet } = await import('../server/data/skill-store.js')
  const { render } = await import('../server/prompts/skill-prompts.js')
  const project = episodeFixture()
  const preview = previewPrompts({ stage: 'outline', root: project, view: project, skillSet: builtinSkillSet() })
  for (const kind of ['characters', 'scenes']) {
    const actual = buildStoryPrompts(project, kind, '', { extraction: true })
    assert.equal(render(preview[`${kind}_generate`].system), actual.generation.system)
    assert.equal(render(preview[`${kind}_generate`].user), actual.generation.user)
    assert.ok(preview[`${kind}_modify`])
    assert.ok(preview[`${kind}_review`])
    assert.ok(preview[`${kind}_revise`])
  }
})

test('outline can be revised before cards exist; staged snapshots use aggregate acceptance', async t => {
  const e = await setupModel(t)
  const fixture = storyPackageFixture()
  await e.store.save(e.id, current => {
    const episode = current.episodes[0]
    episode.plot.outline.content = 'FAILED_OUTLINE'
    episode.plot.characters.items = []
    episode.plot.scenes.items = []
    return current
  })
  let calls = 0
  const replies = [outlineFixture('FIXED_OUTLINE'), reviewPass, JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify(fixture.props), reviewPass]
  await runOperation(e.op('outline', { generationMode: 'modify', review: '修正因果' }), { home: e.home,
    generateStoryPackage: options => generateStoryPackage({ ...options, request: async () => { calls++; return replies.shift() } }),
  })
  const saved = await e.read()
  assert.equal(calls, 8)
  for (const kind of ['outline', 'characters', 'scenes', 'props']) assert.equal(saved.plot[kind].check.passed, true)
  const { contentTargets } = await import('../server/data/task-store.js')
  const root = await e.store.read(e.id)
  assert.equal(contentTargets(root).find(item => item.key === 'story').check.passed, true)
  root.episodes[0].plot.scenes.check.passed = null
  assert.equal(contentTargets(root).find(item => item.key === 'story').check.passed, null)
  root.episodes[0].plot.characters.check = { passed: false, failures: ['缺卡'] }
  assert.equal(contentTargets(root).find(item => item.key === 'story').check.passed, false)
})

test('three models own their structures and prompt assembly without a business base class', () => {
  const project = { ...episodeFixture(), projectSummary: 'PROJECT_BACKGROUND', script: 'SOURCE_SCRIPT', previousEpisodeSummary: 'PREVIOUS', nextEpisodeSummary: 'FOLLOWING' }
  for (const Model of [StoryOutlineModel, StoryCharacterModel, StorySceneModel]) {
    assert.equal(Object.getPrototypeOf(Model.prototype), Object.prototype)
    for (const method of ['contextSegments', 'creationSystem', 'toGenerateSegments', 'toReviseSegments', 'toReviewSegments']) {
      assert.ok(Object.hasOwn(Model.prototype, method), `${Model.name}.${method}`)
    }
  }
  const outline = new StoryOutlineModel({ project, mode: 'generate' })
  const character = new StoryCharacterModel({ project })
  const scene = new StorySceneModel({ project })
  assert.equal(outline.project.script, 'SOURCE_SCRIPT')
  assert.equal(outline.project.nextEpisodeSummary, 'FOLLOWING')
  for (const model of [character, scene]) {
    assert.deepEqual(model.project, { title: project.title })
    assert.equal(model.approvedOutline, project.plot.outline.content)
    const prompt = model.toGenerateMessages()[1].content
    assert.doesNotMatch(prompt, /PROJECT_BACKGROUND|SOURCE_SCRIPT|PREVIOUS|FOLLOWING/)
  }
  assert.ok(character.fields.includes('identity'))
  assert.deepEqual(scene.fields, ['name', 'landmark', 'light', 'space', 'look'])
})

test('edited story material still receives comprehensive review without an extra model', async () => {
  const { buildEditedContentReview } = await import('../server/prompts/text-prompts.js')
  const project = episodeFixture()
  const content = JSON.stringify({ outline: 'EDITED', characters: { items: [] }, scenes: { items: [] } })
  const prompt = buildEditedContentReview({ project, stage: 'outline' }, content)
  assert.equal(prompt.json, true)
  assert.match(prompt.user, /阶段：剧情整包/)
  assert.match(prompt.user, /EDITED/)
  assert.ok(prompt.system.includes(builtinSkill('outline').rules.outline))
  assert.match(prompt.system, /人物、场景卡的覆盖性/)
  assert.match(prompt.system, /先独立从最新大纲盘点/)
  assert.match(prompt.system, /passed 和 issues/)
})

test('大纲生成与修订都提供正文分节和换行结构', () => {
  const model = new StoryOutlineModel({ project: episodeFixture(), mode: 'generate' })
  for (const request of [model.toGenerateMessages(), model.toReviseMessages({ baseContent: '旧大纲', opinion: '改结尾' })]) {
    assert.match(request[0].content, /【正文结构】/)
    assert.match(request[0].content, /小节之间留一个空行/)
    assert.match(request[0].content, /直接使用真实换行/)
  }
})


test('outline section structure is checked deterministically and repairs the latest draft', async () => {
 const { outlineStructureFailures }=await import('../server/generate/story.js')
 assert.equal(outlineStructureFailures(outlineFixture()).length,0)
 assert.ok(outlineStructureFailures('【主角动机】正文挤在同一行').length)
 const fixture=storyPackageFixture(),calls=[]
 const replies=['缺少标题的完整事件稿',reviewPass,outlineFixture(),reviewPass,JSON.stringify(fixture.characters),reviewPass,JSON.stringify(fixture.scenes),reviewPass,JSON.stringify(fixture.props),reviewPass]
 const result=await generateStoryPackage({project:episodeFixture(),request:async message=>{calls.push(message);return replies.shift()}})
 assert.equal(result.check.passed,true);assert.match(calls[2].user,/大纲正文结构/);assert.equal(calls.length,10)
})

test('extraction tasks and review explicitly distinguish offscreen voice and empty scenery',()=>{
 const project=episodeFixture()
 const character=new StoryCharacterModel({project})
 const scene=new StorySceneModel({project})
 for(const request of [character.toGenerateMessages(),character.toReviseMessages({baseContent:'BASE',opinion:'OPINION'}),character.toReviewMessages({content:'LATEST'})])assert.match(request.map(m=>m.content).join('\n'),/全程只有电话或画外声音/)
 for(const request of [scene.toGenerateMessages(),scene.toReviseMessages({baseContent:'BASE',opinion:'OPINION'}),scene.toReviewMessages({content:'LATEST'})])assert.match(request.map(m=>m.content).join('\n'),/不写人物、剪影、身体部位/)
})

test('new semantic review failure clears old execution errors', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, p => { p.episodes[0].activityError = '审核返回格式错误'; for (const key of ['outline', 'characters', 'scenes', 'props']) p.episodes[0].plot[key].error = '审核返回格式错误'; return p })
  const replies = [outlineFixture('新稿'), reviewFail('剧情冲突'), outlineFixture('修订稿'), reviewFail('剧情冲突')]
  await runOperation(e.op('outline'), { home: e.home, generateStoryPackage: opts => generateStoryPackage({ ...opts, request: async () => replies.shift() }) })
  const saved = await e.read()
  for (const key of ['outline', 'characters', 'scenes', 'props']) assert.equal(saved.plot[key].error, null, key)
  assert.equal(saved.plot.outline.check.passed, false)
  assert.equal(saved.activityError, null)
})
