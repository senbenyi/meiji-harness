import { promptData } from './fixtures/prompt-data.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { StoryOutlineModel, StoryCharacterModel, StorySceneModel } from '../server/prompts/models/story-model.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { generateStoryPackage } from '../server/flow/operations/story-text-operations.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { storyPackageFixture, outlineFixture, outlineResponse } from './fixtures/story-package.js'
import { definitions } from '../server/flow/operations/operation-registry.js'
import { runOperation } from '../server/flow/operations/run-operation.js'
import { recordSteps } from './fixtures/steps.js'
import { builtinSkill } from '../skills/load-skills.js'

test('outline tasks only describe the action and refer to separate rule blocks', () => {
  const project = episodeFixture();project.episodeId = project.id
  project.supplementalSkills = { outline: [{ id: 'one', content: 'SUPPLEMENT_REQUIREMENT' }], characters: [{ id: 'other', content: 'OTHER_NODE_RULE' }] }
  for (const generationMode of ['regenerate', 'modify']) checkContext.run({ generationMode, review: '本次人工意见' }, () => {
    const prompts = buildStoryPrompts(project)
    for (const request of [prompts.generation, prompts.revision('最新失败稿', reviewFail('本轮错误'))]) {
      const task = request.user.split('【本次任务】\n')[1].split('\n\n')[0]
      assert.equal(task.split('\n').length, 1)
      assert.match(task, /本集摘要.*剧情大纲.*基础规则和补充规则/)
      assert.doesNotMatch(task, /不输出人物卡|写清人物关系|制作秒数|凑八拍|历史意见|不改变|保留未涉及/)
      assert.match(request.system, /【基础规则】\n/)
      assert.equal(request.system.split('【角色与职责】\n')[1].split('\n\n')[0], '你是一名短剧剧情编剧。')
      assert.match(request.system, /【补充规则】\nSUPPLEMENT_REQUIREMENT/)
      assert.doesNotMatch(request.user, /SUPPLEMENT_REQUIREMENT|OTHER_NODE_RULE/)
      assert.doesNotMatch(request.system, /OTHER_NODE_RULE|【本节点补充要求】/)
      assert.match(request.system, /顶层恰好包含.*七个中文字段/)
    }
    const review = prompts.review('本轮待审稿')
    assert.equal(review.system.split('【角色与职责】\n')[1].split('\n\n')[0], '你是一名独立剧情大纲审核员。')
    assert.match(review.system, /【补充规则】\n逐条核对以下要求；只审核其是否落实/)
    assert.match(review.system, /SUPPLEMENT_REQUIREMENT/)
    assert.doesNotMatch(review.user, /遵守基础规则和补充规则/)
  })
  const other = { ...project, episodeId: 'OTHER_EPISODE', supplementalSkills: { outline: [{ id: 'two', content: 'OTHER_EPISODE_RULE' }] } }
  const request = buildStoryPrompts(other).generation
  assert.match(request.system, /OTHER_EPISODE_RULE/)
  assert.doesNotMatch(request.system, /SUPPLEMENT_REQUIREMENT/)
})

test('outline rule headings preserve supplement source metadata without mutating input', () => {
  const model = new StoryOutlineModel({ project: episodeFixture() })
  const supplement = { source: 'node', title: '【本节点补充要求】', text: '用户补充正文', nodeKey: 'outline', episodeId: 'EP01' }
  const original = structuredClone(supplement)
  for (const request of [model.toGenerateSegments({ additions: [supplement] }), model.toReviewSegments({ content: '待审正文', additions: [supplement] })]) {
    const actual = request.system.find(item => item?.source === 'node')
    assert.deepEqual(actual, { ...original, title: '【补充规则】' })
  }
  assert.deepEqual(supplement, original)
  assert.ok(!model.toGenerateMessages()[0].content.includes('【补充规则】'))
})

for (const [kind, label] of [['characters', '人物角色'], ['scenes', '场景']]) {
  test(`${kind}: actual requests separate task, current outline, style, rules and opinions`, () => {
    const project = { ...episodeFixture(), episodeId: 'EP01', title: 'UNNEEDED_TITLE', episodeNumber: 8, durationSeconds: 38, aspectRatio: '999x555',
      projectSummary: 'UNRELATED_PROJECT_SUMMARY', script: 'UNRELATED_SCRIPT', previousEpisodeSummary: 'UNRELATED_PREVIOUS', nextEpisodeSummary: 'UNRELATED_NEXT',
      style: '写实电影', supplementalSkills: { [kind]: [{ id: 'one', content: 'CURRENT_NODE_RULE' }], outline: [{ id: 'other', content: 'OTHER_NODE_RULE' }] },
      skills: { assets: { outline: [{ id: 'guide', name: '参考动作', guidanceType: 'action', content: 'UNRELATED_ASSET' }] } } }
    project.plot.outline.content = outlineFixture('APPROVED_CURRENT_OUTLINE')
    project.plot[kind].items[0].name = 'OLD_CARD_NAME'
    project.summary.content = 'UNRELATED_EPISODE_SUMMARY'
    for (const outputLanguage of ['zh-CN', 'en']) for (const generationMode of ['generate', 'regenerate', 'modify']) {
      project.outputLanguage = outputLanguage
      checkContext.run({ generationMode, requestedMode: generationMode, originalProject: project, review: 'HUMAN_OPINION' }, () => {
        const prompts = buildStoryPrompts(project, kind)
        const revised = prompts.revision('LATEST_FAILED_CARDS', reviewFail('LATEST_AUDIT_ISSUE'))
        const reviewed = prompts.review('LATEST_CARDS')
        const reReviewed = prompts.review('REPAIRED_CARDS', { baseContent: 'LATEST_FAILED_CARDS', revisionOpinion: reviewFail('LATEST_AUDIT_ISSUE'), revisionReview: true })
        for (const request of [prompts.generation, revised, reviewed, reReviewed]) {
          assert.equal(request.json, true)
          assert.equal((request.user.match(/【本次任务】/g) || []).length, 1)
          const task = request.user.split('【本次任务】\n')[1].split('\n\n')[0]
          assert.equal(task.split('\n').length, 1)
          assert.match(task, new RegExp(`本集已通过大纲.*${label}资料`))
          assert.doesNotMatch(task, /画外|空间|去重|landmark|items|保留未涉及|不改写/)
          assert.deepEqual(promptData(request.user, '【剧情大纲】'), outlineFixture('APPROVED_CURRENT_OUTLINE'))
          assert.deepEqual(promptData(request.user, '【本次要求】'), { style: '写实电影' })
          assert.ok(request.user.indexOf('【本次要求】\n') < request.user.indexOf('【剧情大纲】\n'))
          assert.doesNotMatch(request.user, /【本次目标】|【审核目标】|【事实边界】|阶段：|UNNEEDED_TITLE|999x555|第 8 集|38 秒|UNRELATED_/)
          assert.match(request.system, /【补充规则】\n/)
          assert.equal((request.system.match(/CURRENT_NODE_RULE/g) || []).length, 1)
          assert.doesNotMatch(request.user, /CURRENT_NODE_RULE/)
          assert.doesNotMatch(request.system, /OTHER_NODE_RULE|UNRELATED_ASSET|指导素材编排规则|本节点补充要求/)
          assert.match(request.user, outputLanguage === 'en' ? /输出语言：English/ : /输出语言：简体中文/)
        }
        if (generationMode === 'modify') {
          assert.match(prompts.generation.user, /【修改基稿】/)
          assert.match(prompts.generation.user, /OLD_CARD_NAME|HUMAN_OPINION/)
          assert.match(revised.user, /HUMAN_OPINION/)
        } else {
          assert.doesNotMatch(prompts.generation.user + reviewed.user + revised.user, /OLD_CARD_NAME|HUMAN_OPINION/)
          assert.match(prompts.generation.system, /不沿用旧卡片或历史意见/)
        }
        assert.deepEqual(promptData(revised.user, '【最新失败稿（唯一修改基准）】'), 'LATEST_FAILED_CARDS')
        assert.match(revised.user, /LATEST_AUDIT_ISSUE/)
        assert.doesNotMatch(revised.user, /OLD_CARD_NAME/)
        assert.match(revised.system, /返回完整卡片集合/)
        assert.match(reviewed.system, /【审核标准】/)
        assert.doesNotMatch(reviewed.system, /【本次输出协议】/)
        assert.match(reReviewed.user, /LATEST_FAILED_CARDS|LATEST_AUDIT_ISSUE|REPAIRED_CARDS/)
      })
    }
    const otherEpisode = { ...project, episodeId: 'EP02', supplementalSkills: { [kind]: [{ id: 'two', content: 'OTHER_EPISODE_RULE' }] }, style: '' }
    const request = buildStoryPrompts(otherEpisode, kind).generation
    assert.match(request.system, /OTHER_EPISODE_RULE/)
    assert.doesNotMatch(request.system, /CURRENT_NODE_RULE/)
    assert.match(request.user, /【本次要求】\n输出语言：/);assert.equal('style' in promptData(request.user, '【本次要求】'), false)
  })

  test(`${kind}: protocol example passes the actual card normalizer`, async () => {
    const { normalizeCharacters, normalizeScenes } = await import('../shared/story-content.js')
    const model = kind === 'characters' ? new StoryCharacterModel() : new StorySceneModel()
    const example = model.outputProtocol.split('示例（仅示范格式）：\n')[1]
    const raw = JSON.parse(example)
    assert.deepEqual(Object.keys(raw), ['items'])
    const result = (kind === 'characters' ? normalizeCharacters : normalizeScenes)(raw)
    assert.equal(result.items[0].name, raw.items[0].name)
    if (kind === 'characters') {
      assert.equal(raw.items[0].look.split('\n').length, 10)
      assert.match(result.items[0].look, /国籍：中国.*姓名：旅人.*面相：方脸，浓眉/)
    }
    assert.match(model.outputProtocol, /顶层仅含 items|字符串内换行/)
  })
}

test('outline merges task and target, uses current summary, and limits parameters to duration and style', () => {
  const project = { ...episodeFixture(), title: 'UNNEEDED_TITLE', episodeNumber: 8, aspectRatio: '999x555', durationSeconds: 38, style: '写实电影',
    projectSummary: 'PROJECT_REFERENCE', script: 'SCRIPT_REFERENCE', previousEpisodeSummary: 'PREVIOUS_FACT', nextEpisodeSummary: 'FOLLOWING_DIRECTION' }
  project.summary.content = 'CURRENT_EPISODE_EVENTS'
  for (const mode of ['generate', 'regenerate', 'modify']) {
    const model = new StoryOutlineModel({ project, mode, baseContent: 'CURRENT_BASE', opinion: 'CURRENT_OPINION' })
    const requests = mode === 'modify'
      ? [model.toReviseMessages(), model.toReviseMessages({ baseContent: 'FAILED_BASE', opinion: 'LATEST_ISSUE', automatic: true })]
      : [model.toGenerateMessages()]
    for (const request of requests) {
      const user = request[1].content
      assert.equal((user.match(/【本次任务】/g) || []).length, 1)
      assert.doesNotMatch(user, /【本次目标】|UNNEEDED_TITLE|999x555|本次生成第 8 集/)
      assert.match(user, /本集摘要.*剧情大纲/)
      assert.deepEqual(promptData(user, '【本集摘要】'), 'CURRENT_EPISODE_EVENTS')
      assert.deepEqual(promptData(user, '【本次要求】'), { durationSeconds: 38, style: '写实电影' })
      assert.ok(user.indexOf('【本次任务】') < user.indexOf('【本集摘要】'))
      assert.ok(user.indexOf('【本次要求】\n') < user.indexOf('【本集摘要】\n'))
      assert.deepEqual(promptData(user, '【项目背景】'), 'PROJECT_REFERENCE')
      assert.match(request[0].content, /本集事件以本集摘要为准/)
      assert.deepEqual(promptData(user, '【剧本】'), 'SCRIPT_REFERENCE')
      assert.deepEqual(promptData(user, '【前集摘要】'), 'PREVIOUS_FACT')
      assert.deepEqual(promptData(user, '【后集摘要】'), 'FOLLOWING_DIRECTION')
    }
    const review = model.toReviewMessages({ content: 'LATEST_OUTLINE' })[1].content
    assert.match(review, /【本次任务】\n依据本集摘要，核对待审大纲/)
    assert.match(review, /CURRENT_EPISODE_EVENTS/)
    assert.doesNotMatch(review, /【本次目标】|仅生成本集完整剧情大纲/)
  }
})

for (const [Model, kind] of [[StoryOutlineModel, 'outline'], [StoryCharacterModel, 'characters'], [StorySceneModel, 'scenes']]) {
  test(`${kind}: model independently assembles generation, revision and review`, () => {
    const model = new Model({ project: episodeFixture(), mode: 'modify', baseContent: 'BASE', opinion: 'HUMAN', generationRules: 'RULE', reviewRules: 'REVIEW_RULE' })
    const generated = model.toGenerateMessages()
    assert.deepEqual(generated.map(message => message.role), ['system', 'user'])
    assert.match(generated[0].content, kind === 'outline' ? /顶层恰好包含.*七个中文字段/ : /\{"items":\[/)
    assert.match(generated[0].content, /示例（仅示范格式/)
    assert.doesNotMatch(generated[0].content, /【优先级】/)
    const revised = model.toReviseMessages({ baseContent: 'LATEST', opinion: reviewFail('NEW'), automatic: true })
    assert.match(revised[1].content, /LATEST/)
    assert.match(revised[1].content, /HUMAN/)
    assert.doesNotMatch(revised[1].content, /BASE/)
    const reviewed = model.toReviewMessages({ content: 'RESULT' })
    assert.match(reviewed[0].content, /独立.*审核员/)
    assert.match(reviewed[0].content, /【审核标准】\nREVIEW_RULE/)
    assert.doesNotMatch(reviewed[0].content + reviewed[1].content, /(^|[^_])RULE/)
    assert.match(reviewed[1].content, /BASE/)
    assert.match(reviewed[1].content, /RESULT/)
    for (const automatic of [false, true]) {
      const review = model.toReviewMessages({ content: 'RESULT', automatic })
      assert.match(review[0].content, /【本次审核协议】/)
      if (kind === 'outline') assert.match(review[1].content, /【本次任务】\n依据本集摘要，核对待审大纲/)
      else assert.match(review[1].content, /【本次任务】\n依据本集已通过大纲审核最新/)
      assert.doesNotMatch(review[1].content, /仅生成本集完整剧情大纲|返回人物 items|返回无人物的环境卡 items/)
      assert.doesNotMatch(review[0].content, /JSON 字符串里的换行正确转义/)
    }
    assert.doesNotMatch(generated[1].content, /【审核目标】|【本次审核协议】/)
    assert.doesNotMatch(revised[1].content + revised[0].content, /【审核目标】|【本次审核协议】/)
  })
}

test('review returning an outline instead of a verdict fails and retains the generated draft', async () => {
  const draft = outlineFixture('生成稿')
  let calls = 0
  const saved = []
  await assert.rejects(generateStoryPackage({ project: episodeFixture(), request: async () =>
    ++calls === 1 ? JSON.stringify(draft) : JSON.stringify(draft),
    persist: result => saved.push(structuredClone(result)),
  }), /审核返回格式错误/)
  assert.equal(calls, 2)
  assert.deepEqual(saved.at(-1).outline, draft)
})

test('每个剧情步骤生成用生产规则、自审用对应审核 skill，输出协议独立', () => {
  for (const [kind, generation, criteria, other] of [
    ['outline', '故事大纲', '大纲验收', '人物验收|场景验收'],
    ['characters', '角色卡', '人物验收', '大纲验收|场景验收'],
    ['scenes', '场景卡', '场景验收', '大纲验收|人物验收'],
  ]) {
    const prompts = buildStoryPrompts(episodeFixture(), kind)
    const rules = builtinSkill('outline').rules[kind]
    assert.ok(rules.trim())
    assert.ok(prompts.generation.system.includes(rules))
    const review = builtinSkill('outline').reviewRules[kind]
    assert.ok(review.trim())
    assert.ok(prompts.review('DRAFT').system.includes(review))
    assert.ok(!prompts.review('DRAFT').system.includes(rules))
    assert.ok(!prompts.generation.system.includes(review))
    assert.doesNotMatch(prompts.review('DRAFT').system, new RegExp(other))
    assert.doesNotMatch(prompts.generation.system, /【自检标准】|审核通用协议|一次调用、一次返回完整结果/)
    assert.doesNotMatch(prompts.review('DRAFT').system, /审核通用协议|独立审片师/)
  }
})

test('plan has distinct targets and a failed outline skips all extraction requests', async () => {
  assert.deepEqual(definitions.outline.plan().filter(step => step.kind === 'generate').map(step => step.target), ['outline', 'characters', 'scenes', 'props'])
  const replies = [JSON.stringify(outlineFixture('初稿')), reviewFail('因果错误'), JSON.stringify(outlineFixture('修订稿')), reviewFail('因果错误')]
  let calls = 0
  const { result, steps } = await recordSteps(() => generateStoryPackage({ project: episodeFixture(), request: async () => { calls++; return replies.shift() } }))
  assert.equal(calls, 4)
  assert.deepEqual(result.outline, outlineFixture('修订稿'))
  assert.equal(result.checks.characters.passed, null)
  assert.ok(result.characters.stale)
  assert.equal(result.check.passed, false)
  assert.ok(steps.every(step => step.target === 'outline'))
})

test('a card API error retains drafts saved by earlier independent stages', async () => {
  let calls = 0
  const saved = []
  await assert.rejects(generateStoryPackage({ project: episodeFixture(), request: async () => {
    if (++calls === 1) return outlineResponse('已生成大纲')
    if (calls === 2) return reviewPass
    throw new Error('CHARACTER_API_ERROR')
  }, persist: result => saved.push(structuredClone(result)) }), /CHARACTER_API_ERROR/)
  assert.equal(calls, 3)
  assert.deepEqual(saved.at(-1).outline, outlineFixture('已生成大纲'))
  assert.equal(saved.at(-1).checks.outline.passed, true)
  assert.equal(saved.at(-1).checks.characters.passed, null)
})

test('extraction after outline modification uses new facts, never stale card bases or old opinions', async () => {
  const project = episodeFixture()
  project.plot.outline.content = outlineFixture('OLD_OUTLINE')
  const fixture = storyPackageFixture()
  const replies = [outlineResponse('FINAL_NEW_OUTLINE'), reviewPass, JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify(fixture.props), reviewPass]
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
  const replies = [outlineResponse('FINAL_OUTLINE'), reviewPass, JSON.stringify(fixture.characters), reviewFail('缺少另一身体'), JSON.stringify(fixture.characters), reviewFail('缺少另一身体')]
  let calls = 0
  await runOperation(e.op('outline', { generationMode: 'regenerate' }), { home: e.home,
    generateStoryPackage: options => generateStoryPackage({ ...options, request: async () => { calls++; return replies.shift() } }),
  })
  const saved = await e.read()
  assert.equal(calls, 6)
  assert.deepEqual(saved.plot.outline.content, outlineFixture('FINAL_OUTLINE'))
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
      if (++calls === 1) return outlineResponse('PASSED_OUTLINE')
      if (calls === 2) return reviewPass
      throw new Error('CHARACTER_ERROR')
    } }),
  }), /CHARACTER_ERROR/)
  const saved = await e.read()
  assert.deepEqual(saved.plot.outline.content, outlineFixture('PASSED_OUTLINE'))
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
    return calls === 1 ? outlineResponse('NEW_OUTLINE') : reviewPass
  }, persist: result => {
    saved.push(structuredClone(result))
    if (result.checks.outline.passed) controller.abort()
  } }), { name: 'AbortError' })
  assert.equal(calls, 2)
  assert.deepEqual(saved.at(-1).outline, outlineFixture('NEW_OUTLINE'))
  assert.equal(saved.at(-1).checks.outline.passed, true)
})

test('preview exposes all three models with the same prompt builders', async () => {
  const { previewPrompts } = await import('../server/prompts/preview-prompts.js')
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
    episode.plot.outline.content = outlineFixture('FAILED_OUTLINE')
    episode.plot.characters.items = []
    episode.plot.scenes.items = []
    return current
  })
  let calls = 0
  const replies = [outlineResponse('FIXED_OUTLINE'), reviewPass, JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify(fixture.props), reviewPass]
  await runOperation(e.op('outline', { generationMode: 'modify', review: '修正因果' }), { home: e.home,
    generateStoryPackage: options => generateStoryPackage({ ...options, request: async () => { calls++; return replies.shift() } }),
  })
  const saved = await e.read()
  assert.equal(calls, 8)
  for (const kind of ['outline', 'characters', 'scenes', 'props']) assert.equal(saved.plot[kind].check.passed, true)
  const { contentTargets } = await import('../server/data/content-records.js')
  const root = await e.store.read(e.id)
  assert.equal(contentTargets(root).find(item => item.key === 'story').check.passed, true)
  root.episodes[0].plot.scenes.check.passed = null
  assert.equal(contentTargets(root).find(item => item.key === 'story').check.passed, null)
  root.episodes[0].plot.characters.check = { passed: false, failures: ['缺卡'] }
  assert.equal(contentTargets(root).find(item => item.key === 'story').check.passed, false)
})

test('四类剧情资料共用 StoryModel，差异只在 storyKinds 配置中声明', async () => {
  const { StoryModel, storyKinds } = await import('../server/prompts/models/story-model.js')
  const project = { ...episodeFixture(), projectSummary: 'PROJECT_BACKGROUND', script: 'SOURCE_SCRIPT', previousEpisodeSummary: 'PREVIOUS', nextEpisodeSummary: 'FOLLOWING' }
  assert.deepEqual(Object.keys(storyKinds), ['outline', 'characters', 'scenes', 'props'])
  for (const Model of [StoryOutlineModel, StoryCharacterModel, StorySceneModel]) assert.equal(Object.getPrototypeOf(Model.prototype), StoryModel.prototype)
  const outline = new StoryOutlineModel({ project, mode: 'generate' })
  const character = new StoryCharacterModel({ project })
  const scene = new StorySceneModel({ project })
  assert.equal(outline.project.script, 'SOURCE_SCRIPT')
  assert.equal(outline.project.nextEpisodeSummary, 'FOLLOWING')
  for (const model of [character, scene]) {
    assert.deepEqual(model.project, { title: project.title })
    assert.deepEqual(model.approvedOutline, project.plot.outline.content)
    const prompt = model.toGenerateMessages()[1].content
    assert.doesNotMatch(prompt, /PROJECT_BACKGROUND|SOURCE_SCRIPT|PREVIOUS|FOLLOWING/)
  }
  assert.ok(character.fields.includes('identity'))
  assert.deepEqual(scene.fields, ['name', 'landmark', 'light', 'space', 'look'])
})

test('人工编辑大纲仅审核最新七字段大纲，不要求下游卡片', async () => {
  const { buildEditedContentReview } = await import('../server/prompts/text-prompts.js')
  const content = outlineFixture('EDITED'), prompt = buildEditedContentReview({ project: episodeFixture(), stage: 'outline' }, JSON.stringify(content))
  assert.equal(prompt.json, true)
  assert.deepEqual(promptData(prompt.user, '【本次待审内容】'), content)
  assert.ok(prompt.system.includes(builtinSkill('outline').reviewRules.outline))
  for (const kind of ['characters', 'scenes']) assert.ok(!prompt.system.includes(builtinSkill('outline').reviewRules[kind]))
  assert.doesNotMatch(prompt.user, /阶段：剧情整包|【审核目标】/)
  assert.equal(prompt.system.split('【角色与职责】\n')[1].split('\n\n')[0], '你是一名独立剧情大纲审核员。')
  assert.match(prompt.system, /passed 和 issues/)
})

test('大纲生成与修订协议固定七个中文字段，正文换行只在值中', async () => {
  const { outlineFields, normalizeOutline } = await import('../shared/story-outline.js')
  for (const outputLanguage of ['zh-CN', 'en']) {
    const model = new StoryOutlineModel({ project: { ...episodeFixture(), outputLanguage }, mode: 'generate' })
    for (const request of [model.toGenerateMessages(), model.toReviseMessages({ baseContent: outlineFixture(), opinion: '改结尾' })]) {
      const example = JSON.parse(request[0].content.split('示例（仅示范格式）：\n')[1])
      assert.deepEqual(Object.keys(normalizeOutline(example)), outlineFields)
      assert.match(example['因果剧情'], /\n2\./)
      for (const value of Object.values(example)) assert.doesNotMatch(value, /【/)
      assert.match(request[0].content, /字段名固定为中文/)
      assert.match(request[1].content, outputLanguage === 'en' ? /输出语言：English/ : /输出语言：简体中文/)
    }
  }
})

test('无效大纲对象触发程序校验，修订使用最新失败对象', async () => {
  const { outlineStructureFailures } = await import('../shared/story-content.js')
  assert.equal(outlineStructureFailures(outlineFixture()).length, 0)
  assert.ok(outlineStructureFailures('【主角动机】正文').length)
  const fixture = storyPackageFixture(), calls = [], invalid = { ...fixture.outline, 因果剧情: '' }
  const replies = [JSON.stringify(invalid), reviewPass, outlineResponse(), reviewPass, JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify(fixture.props), reviewPass]
  const result = await generateStoryPackage({ project: episodeFixture(), request: async message => { calls.push(message); return replies.shift() } })
  assert.equal(result.check.passed, true);assert.equal(calls.length, 10)
  assert.match(calls[2].user, /大纲字段「因果剧情」必须为非空字符串/)
  assert.deepEqual(promptData(calls[2].user, '【最新失败稿（唯一修改基准）】'), invalid)
})

test('extraction rules and review distinguish offscreen voice and empty scenery in system only',()=>{
 for (const kind of ['characters', 'scenes']) {
  const prompts = buildStoryPrompts(episodeFixture(), kind)
  for (const request of [prompts.generation, prompts.revision('BASE', reviewFail('OPINION')), prompts.review('LATEST')]) {
   assert.match(request.system, kind === 'characters' ? /画外声音.*不出镜|画外声音、全程不出镜/ : /人物、人群、剪影、手、脸/)
   assert.doesNotMatch(request.user, /全程只有电话或画外声音|不写人物、剪影、身体部位|【事实边界】/)
  }
 }
})

test('new semantic review failure clears old execution errors', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, p => { p.episodes[0].activityError = '审核返回格式错误'; for (const key of ['outline', 'characters', 'scenes', 'props']) p.episodes[0].plot[key].error = '审核返回格式错误'; return p })
  const replies = [outlineResponse('新稿'), reviewFail('剧情冲突'), outlineResponse('修订稿'), reviewFail('剧情冲突')]
  await runOperation(e.op('outline'), { home: e.home, generateStoryPackage: opts => generateStoryPackage({ ...opts, request: async () => replies.shift() }) })
  const saved = await e.read()
  for (const key of ['outline', 'characters', 'scenes', 'props']) assert.equal(saved.plot[key].error, null, key)
  assert.equal(saved.plot.outline.check.passed, false)
  assert.equal(saved.activityError, null)
})
