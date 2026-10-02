import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEpisodeDraft } from '../server/generate/story.js'
import { EpisodeSummaryModel } from '../server/prompts/models/episode-summary-model.js'
import { builtinSkill } from '../skills/load.js'
const episodePrompt = (project, episodeId) => new EpisodeSummaryModel({ project, episodeId, generationRules: builtinSkill('episode').constraints }).toMessages().map(message => message.content).join('\n')

test('the first episode is written from the project summary and uses the reference duration range', () => {
  const prompt = episodePrompt({ title: '桃源', summary: { content: '李伟穿越' }, episodes: [], aspectRatio: '768x1344', style: '写实电影' })
  assert.match(prompt, /第 1 集根据项目摘要/)
  assert.match(prompt, /李伟穿越/)
  assert.match(prompt, /视觉风格：写实电影/)
  assert.deepEqual(normalizeEpisodeDraft({ summary: '开场结义', durationSeconds: 170 }), { summary: '开场结义', durationSeconds: 170 })
  assert.throws(() => normalizeEpisodeDraft({ summary: '太长', durationSeconds: 171 }), { status: 502 })
})

test('a later episode continues from the episodes already shot', () => {
  const prompt = episodePrompt({
    title: '桃源',
    summary: { content: '李伟穿越' },
    episodes: [
      { summary: { content: '第二集回头' }, durationSeconds: 90 },
      { summary: { content: '第一集结义' }, durationSeconds: 120 },
    ],
  })
  assert.match(prompt, /第 3 集/)
  assert.match(prompt, /【输入内容：视频总摘要】\n项目摘要：李伟穿越/)
  assert.match(prompt, /之前全部剧集摘要，按剧情顺序/)
  assert.ok(prompt.indexOf('第一集结义') < prompt.indexOf('第二集回头'))
  assert.match(prompt, /不无故重置人物状态/)
  assert.match(prompt, /第 1 集（120 秒）：第一集结义/)
  assert.match(prompt, /第 2 集（90 秒）：第二集回头/)

})

test('regeneration targets the selected episode and separates later continuity constraints', () => {
  const project = { title: '故事', summary: { content: '总摘要' }, script: '项目剧本', episodes: [
    { id: 'c', summary: { content: '结尾' }, durationSeconds: 60 },
    { id: 'b', summary: { content: '旧中段' }, durationSeconds: 90 },
    { id: 'a', summary: { content: '开场' }, durationSeconds: 120 },
  ] }
  const prompt = episodePrompt(project, 'b')
  assert.match(prompt, /这一集是第 2 集/)
  assert.match(prompt, /第 1 集（120 秒）：开场/)
  assert.match(prompt, /后续剧集是衔接约束/)
  assert.match(prompt, /第 3 集：结尾/)
  assert.match(prompt, /项目剧本/)
  assert.throws(() => episodePrompt(project, 'missing'), { status: 404 })
})

test('summary modes separate old input, review content and revision-only rules', async () => {
  const { buildEpisodePrompts } = await import('../server/prompts/episode-prompts.js')
  const { checkContext } = await import('../server/data/operation-context.js')
  const project = { title: '故事', summary: { content: 'PROJECT_BACKGROUND' }, episodes: [
    { id: 'next', summary: { content: 'NEXT_EPISODE' }, durationSeconds: 120 },
    { id: 'target', summary: { content: 'OLD_SUMMARY' }, durationSeconds: 120 },
  ] }
  for (const generationMode of ['regenerate', 'modify']) {
    checkContext.run({ generationMode, review: 'HUMAN_OPINION' }, () => {
      const prompts = buildEpisodePrompts(project, 'target')
      const { generation } = prompts
      assert.ok(generation.system.includes(builtinSkill('episode').constraints))
      assert.doesNotMatch(generation.system, /共用生成审核流程|后端验收（未通过则重写）|以原摘要的既定事件为基准/)
      assert.equal(generation.system.includes('【本次修订范围】'), generationMode === 'modify')
      assert.equal(generation.user.includes('OLD_SUMMARY'), generationMode === 'modify')
      assert.equal(generation.user.includes('HUMAN_OPINION'), generationMode === 'modify')
      assert.match(generation.user, /NEXT_EPISODE/)
      assert.equal(prompts.review('NEW_SUMMARY').user.includes('OLD_SUMMARY'), generationMode === 'modify')
      const revision = prompts.revision('FAILED_SUMMARY', reviewFail('原因'))
      assert.match(revision.system, /【本次修订范围】/)
      assert.match(revision.user, /FAILED_SUMMARY/)
      assert.doesNotMatch(revision.user, /OLD_SUMMARY|重新生成/)
    })
  }
})

for (const mode of ['new', 'regenerate', 'modify']) {
  test(`summary ${mode} runs through the real operation with episode-scoped check context`, async t => {
    const { setupModel } = await import('./fixtures/model.js')
    const { modelStore } = await import('../server/data/model-settings.js')
    const { runOperation } = await import('../server/flow/operations/run.js')
    const { generateEpisode } = await import('../server/generate/story.js')
    const e = await setupModel(t), models = modelStore(e.home)
    await models.write({ ...await models.read(), apiKey: 'test-only' })
    const root = await e.store.read(e.id), old = root.episodes[0].summary.content, calls = []
    await runOperation({ action: 'episode-generate', projectId: e.id, referenceDurationSeconds: 10,
      ...(mode === 'new' ? {} : { episodeId: e.episodeId, generationMode: mode }),
      ...(mode === 'modify' ? { review: '加强悬念' } : {}),
    }, { home: e.home, generateEpisode: options => generateEpisode({ ...options,
      request: async message => {
        calls.push(message)
        return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '旅人入院后发现新的线索。', durationSeconds: 10 })
      },
    }) })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].user.includes('【修改基稿】'), mode === 'modify')
    if (mode === 'modify') { assert.ok(calls[0].user.includes(old)); assert.match(calls[0].user, /加强悬念/) }
    if (mode === 'regenerate') assert.equal(calls[0].user.includes(old), false)
    const saved = await e.store.read(e.id)
    assert.equal(saved.episodes.length, root.episodes.length + (mode === 'new' ? 1 : 0))
    const episode = saved.episodes.find(item => item.summary.content === '旅人入院后发现新的线索。')
    assert.equal(episode.summary.status, 'passed')
    assert.equal(episode.summary.error, null)
    assert.equal(episode.summary.check.passed, true)
    if (mode === 'modify') assert.equal(episode.summary.review.text, '')
    assert.notEqual(episode.status, 'generating')
    assert.notEqual(saved.status, 'generating')
  })
}

test('summary checks run after drafting and independent review receives the same acceptance constraints', async () => {
  const { buildEpisodePrompts } = await import('../server/prompts/episode-prompts.js')
  const prompts = buildEpisodePrompts({ title: '故事', summary: { content: '总摘要' }, episodes: [] })
  const rules = builtinSkill('episode').constraints
  assert.ok(prompts.generation.system.includes(rules))
  assert.match(prompts.generation.system, /不输出检查过程/)
  const review = prompts.review('{"summary":"待审摘要","durationSeconds":120}')
  assert.ok(review.system.includes(rules))
  assert.match(review.system, /无具体违规依据时不判失败/)
  assert.match(review.system, /只审核，不生成或修改原文/)
  assert.match(review.user, /【本次待审内容】\n.*待审摘要/)
})

for (const scenario of ['failed', 'new-opinion']) {
  test(`summary modification keeps opinions when ${scenario}`, async t => {
    const { setupModel } = await import('./fixtures/model.js')
    const { modelStore } = await import('../server/data/model-settings.js')
    const { runOperation } = await import('../server/flow/operations/run.js')
    const { saveReview } = await import('../shared/drama-model.js')
    const e = await setupModel(t), models = modelStore(e.home)
    await models.write({ ...await models.read(), apiKey: 'test-only' })
    await runOperation({ action: 'episode-generate', projectId: e.id, episodeId: e.episodeId,
      generationMode: 'modify', review: '已提交意见', referenceDurationSeconds: 10,
    }, { home: e.home, generateEpisode: async () => {
      if (scenario === 'new-opinion') await e.store.save(e.id, current => {
        const next = structuredClone(current)
        saveReview(next.episodes.find(item => item.id === e.episodeId).summary, '执行期间新意见')
        return next
      })
      return { summary: '旅人发现线索。', durationSeconds: 10,
        check: { passed: scenario !== 'failed', failures: scenario === 'failed' ? ['冲突'] : [] } }
    } })
    const saved = await e.store.read(e.id)
    assert.equal(saved.episodes.find(item => item.id === e.episodeId).summary.review.text,
      scenario === 'failed' ? '已提交意见' : '执行期间新意见')
  })
}
