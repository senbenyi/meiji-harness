import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { buildTablePrompts, buildSecondsPrompts } from '../server/prompts/shot-prompts.js'
import { runGenerationNode, runReviewNode, runTextWorkflow } from '../server/generate/text-workflow.js'
import { runTextRequest } from '../server/generate/text-request.js'
import { generateStoryPackage, regenerateCardGroup } from '../server/generate/story.js'
import { generateShots, generateShotSeconds } from '../server/generate/shot-text.js'
import { checkContext } from '../server/data/self-checks.js'
import { runOperation } from '../server/flow/actions.js'
import { modelStore } from '../server/data/models.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { storyPackageFixture } from './fixtures/story-package.js'

const route = { baseUrl: 'https://model.test/v1', apiKey: 'test', model: 'test' }
const response = content => Response.json({ choices: [{ message: { content } }] })
const table = '## S01 / 5s\n标题：入院\n旅人进入庭院。\n## S02 / 5s\n标题：寻人\n旅人继续寻找。'

for (const stage of ['package', 'characters', 'scenes', 'shots', 'seconds']) {
  test(`${stage}: generation, review and revision each submit exactly system and user`, async () => {
    const project = { ...episodeFixture(), outputLanguage: 'en', customSkills: { outline: 'CUSTOM_RULE', shots: 'CUSTOM_RULE', seconds: 'CUSTOM_RULE' } }
    const prompts = stage === 'shots' ? buildTablePrompts({ project }) : stage === 'seconds' ? buildSecondsPrompts({ project, shotId: 'S01' }) : buildStoryPrompts(project, stage)
    for (const [message, isReview] of [[prompts.generation, false], [prompts.review('CURRENT_DRAFT'), true], [prompts.revision('LATEST_FAILED', 'FAIL REVIEW_REASON'), false]]) {
      await runTextRequest(message, { route, fetchImpl: async (_, options) => {
        const payload = JSON.parse(options.body)
        assert.deepEqual(payload.messages.map(item => item.role), ['system', 'user'])
        assert.equal('max_tokens' in payload, false)
        assert.equal(payload.messages[0].content, message.system)
        assert.equal(payload.messages[1].content, message.user)
        assert.match(message.system, /本次生成语言：English/)
        assert.equal(message.user.split('CUSTOM_RULE').length - 1, 1)
        assert.equal(Boolean(payload.response_format), !isReview && ['package', 'characters', 'scenes'].includes(stage))
        if (isReview) {
          assert.match(message.user, /CURRENT_DRAFT/)
          assert.match(message.user, /生成规范/)
          assert.match(message.system, /只审核，不生成或修改原文/)
        }
        return response(isReview ? 'PASS' : 'result')
      } })
    }
  })
}

test('story regeneration excludes old results; revision uses only latest failed draft and original opinion', async () => {
  const project = episodeFixture()
  project.plot.outline.content = 'OLD_DRAFT'
  await checkContext.run({ generationMode: 'regenerate', review: 'OLD_OPINION' }, () => {
    const prompts = buildStoryPrompts(project)
    assert.doesNotMatch(prompts.generation.user, /OLD_DRAFT|OLD_OPINION/)
    assert.doesNotMatch(prompts.review('NEW_DRAFT').user, /OLD_DRAFT|OLD_OPINION/)
  })
  await checkContext.run({ generationMode: 'modify', review: 'HUMAN_OPINION' }, () => {
    const prompts = buildStoryPrompts(project)
    assert.match(prompts.generation.user, /OLD_DRAFT/)
    assert.match(prompts.generation.user, /HUMAN_OPINION/)
    const revision = prompts.revision('LATEST_FAILED', 'FAIL NEW_REASON')
    assert.match(revision.user, /LATEST_FAILED/)
    assert.match(revision.user, /NEW_REASON/)
    assert.match(revision.user, /HUMAN_OPINION/)
    assert.doesNotMatch(revision.user, /OLD_DRAFT/)
    assert.doesNotMatch(prompts.review('FIXED').user, /LATEST_FAILED|NEW_REASON|OLD_DRAFT/)
  })
})

test('generation and review nodes run independently and the draft is saved before review starts', async () => {
  const prompts = buildStoryPrompts(episodeFixture())
  let saved, calls = 0
  const text = await runGenerationNode({ message: prompts.generation,
    options: { request: async () => { calls++; return 'SAVED_DRAFT' } },
    persist: async (text, check) => { saved = text; assert.equal(check.passed, null) },
  })
  assert.equal(calls, 1)
  assert.equal(saved, text)
  const result = await runReviewNode({ message: prompts.review(saved), options: { request: async ({ user }) => {
    calls++; assert.match(user, /SAVED_DRAFT/); return 'PASS'
  } } })
  assert.equal(calls, 2)
  assert.equal(result.check.passed, true)
})

test('workflow persists each new draft before its separate review request', async () => {
  const events = [], replies = ['DRAFT', 'FAIL 缺少动作', 'FIXED', 'PASS']
  await runTextWorkflow({ prompts: buildStoryPrompts(episodeFixture()), options: {
    project: episodeFixture(), request: async ({ skill }) => { events.push(skill === 'skill-gongyong-content-review' ? 'review' : 'generate'); return replies.shift() },
  }, persist: async (text, check) => events.push(`${text}:${check.passed}`) })
  assert.deepEqual(events, ['generate', 'DRAFT:null', 'review', 'DRAFT:false', 'generate', 'FIXED:null', 'review', 'FIXED:true'])
})

for (const action of ['outline', 'characters', 'scenes', 'shots', 'shot-seconds']) {
  test(`${action}: review API error retains saved draft and never marks it passed`, async t => {
    const e = await setupModel(t), models = modelStore(e.home)
    await models.write({ ...await models.read(), apiKey: 'test-only' })
    const raw = storyPackageFixture()
    raw.outline = '本轮新大纲'
    raw.characters.items[0].appearance = '本轮新的角色外貌'
    raw.scenes.items[0].look = '本轮新的场景，庭院地标与通路清晰可辨'
    let calls = 0
    const fetchImpl = async () => {
      if (++calls === 2) {
        const saved = await e.read()
        if (action === 'outline') assert.equal(saved.plot.outline.content, raw.outline)
        if (action === 'characters') assert.equal(saved.plot.characters.items[0].appearance, raw.characters.items[0].appearance)
        if (action === 'scenes') assert.equal(saved.plot.scenes.items[0].look, raw.scenes.items[0].look)
        if (action === 'shots') assert.match(saved.shots.items[0].content, /入院/)
        if (action === 'shot-seconds') assert.equal(saved.shots.items[0].seconds.content, '新每秒指令')
        throw new Error('REVIEW_UNAVAILABLE')
      }
      return response(action === 'shots' ? table : action === 'shot-seconds' ? '新每秒指令' : JSON.stringify(action === 'outline' ? raw : raw[action]))
    }
    const deps = { home: e.home,
      generateStoryPackage: options => generateStoryPackage({ ...options, fetchImpl }),
      regenerateCardGroup: options => regenerateCardGroup({ ...options, fetchImpl }),
      generateShots: options => generateShots({ ...options, fetchImpl }),
      generateShotSeconds: options => generateShotSeconds({ ...options, fetchImpl }),
    }
    await assert.rejects(runOperation(e.op(action, { generationMode: 'regenerate', ...(action === 'shot-seconds' ? { track: 'S01' } : {}) }), deps), /REVIEW_UNAVAILABLE/)
    const saved = await e.read()
    const node = action === 'outline' ? saved.plot.outline : ['characters', 'scenes'].includes(action) ? saved.plot[action] : action === 'shots' ? saved.shots : saved.shots.items[0].seconds
    assert.notEqual(node.check.passed, true)
    assert.equal(node.operation, null)
    assert.match(node.error, /REVIEW_UNAVAILABLE/)
    assert.equal(calls, 2)
  })
}


test('story regeneration omits the episode summary while modification includes it', () => {
  const project = { ...episodeFixture(), projectSummary: 'PROJECT_BACKGROUND', episodeNumber: 2,
    previousEpisodeSummary: 'PREVIOUS_EPISODE', nextEpisodeSummary: 'NEXT_EPISODE' }
  project.summary.content = 'OLD_EPISODE_SUMMARY'
  project.plot.outline.content = 'OLD_STORY'
  checkContext.run({ generationMode: 'regenerate', review: 'OLD_REVIEW' }, () => {
    const prompts = buildStoryPrompts(project)
    for (const message of [prompts.generation, prompts.review('NEW_STORY')]) {
      assert.doesNotMatch(message.user, /OLD_EPISODE_SUMMARY|OLD_STORY|OLD_REVIEW/)
      assert.match(message.user, /PROJECT_BACKGROUND/)
      assert.match(message.user, /PREVIOUS_EPISODE/)
      assert.match(message.user, /NEXT_EPISODE/)
      assert.match(message.user, /第 2 集/)
    }
    assert.doesNotMatch(prompts.generation.system, /大纲的（N秒）|单类卡片修订|共用生成审核流程|H3|detailed_description|最多自动修订/)
    assert.doesNotMatch(prompts.revision('FAILED_STORY', 'FAIL 原因').user, /重新生成，仅使用/)
  })
  checkContext.run({ generationMode: 'modify', review: 'CHANGE_ROLE' }, () => {
    const message = buildStoryPrompts(project).generation
    assert.match(message.user, /OLD_EPISODE_SUMMARY/)
    assert.match(message.user, /OLD_STORY/)
    assert.match(message.user, /CHANGE_ROLE/)
  })
})
