import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlannerService } from '../../src/application/planning-service.js'

function response(chapters = 3) {
  return JSON.stringify({
    synopsis: '两名旧识在雨夜列车重逢并重新作出选择。',
    castPrompt: '两名成年角色分开站立，中性背景，正面全身定妆。',
    chapters: Array.from({ length: chapters }, (_, chapterIndex) => ({
      title: `叙事阶段 ${chapterIndex + 1}`,
      summary: `阶段 ${chapterIndex + 1} 发生新的事件`,
      anchors: Array.from({ length: 6 }, (_, anchorIndex) => ({
        imagePrompt: `阶段 ${chapterIndex + 1} 的具体画面 ${anchorIndex + 1}，人物动作和道具状态均有变化`,
        motionPrompt: `人物完成动作 ${anchorIndex + 1}，镜头稳定推进`,
      })),
    })),
  })
}

test('uses the configured Qwen provider and returns six concrete anchors per chapter', async () => {
  let request
  const ctx = { llm: { async *stream(value) {
    request = value
    yield { type: 'text-delta', index: 0, text: response() }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  const planner = createPlannerService(ctx)
  const result = await planner.plan({
    episodeId: 'episode-01', sourceText: '雨夜列车上的重逢。', targetDurationSec: 60,
    aspectRatio: '16:9', stylePrompt: '写实电影感', castPrompt: '',
  })

  assert.equal(request.provider, 'qwen38-local')
  assert.equal(request.model, 'qwen3.8-27b-video-prompt')
  assert.match(request.messages[0].content[0].text, /^\/no_think/)
  assert.match(request.messages[0].content[0].text, /16:9 横屏/)
  assert.equal(result.plan.source, 'producer-agent')
  assert.equal(result.plan.chapters.length, 3)
  assert.equal(result.plan.chapters.every(chapter => chapter.anchors.length === 6), true)
  assert.equal(result.plan.chapters[0].anchors[0].role, 'start')
  assert.equal(result.plan.chapters[0].anchors[1].role, 'continuation')
})

test('uses a model routing change made after the planner service starts', async () => {
  let request
  const config = { planner: { provider: 'first', model: 'model-a', maxTokens: 4096 } }
  const ctx = { llm: { async *stream(value) {
    request = value
    yield { type: 'text-delta', index: 0, text: response(1) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  const planner = createPlannerService(ctx, config)
  config.planner = { provider: 'second', model: 'model-b', maxTokens: 8192 }
  await planner.plan({ episodeId: 'episode-switch', sourceText: '切换模型。', targetDurationSec: 20 })

  assert.equal(request.provider, 'second')
  assert.equal(request.model, 'model-b')
  assert.equal(request.maxTokens, 8192)
})

test('accepts validated JSON when Qwen exposes it only as reasoning output', async () => {
  const ctx = { llm: { async *stream() {
    yield { type: 'reasoning-delta', index: 0, text: response(1) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  const result = await createPlannerService(ctx).plan({
    episodeId: 'episode-reasoning', sourceText: '月球便利店。', targetDurationSec: 20,
  })

  assert.equal(result.plan.chapters.length, 1)
  assert.equal(result.plan.chapters[0].anchors.length, 6)
})

test('rejects malformed planner output instead of silently creating a fake draft', async () => {
  const ctx = { llm: { async *stream() {
    yield { type: 'text-delta', index: 0, text: '{"chapters":[]}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  await assert.rejects(
    createPlannerService(ctx).plan({ episodeId: 'episode-01', sourceText: '故事', targetDurationSec: 60 }),
    /应返回 3 章/,
  )
})

test('splits long-video planning into bounded calls and carries continuity forward', async () => {
  const prompts = []
  let call = 0
  const ctx = { llm: { async *stream(request) {
    prompts.push(request.messages[0].content[0].text)
    yield { type: 'text-delta', index: 0, text: response(call++ === 0 ? 5 : 1) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  const result = await createPlannerService(ctx).plan({
    episodeId: 'episode-long', sourceText: '一段需要持续推进的长故事。', targetDurationSec: 120,
    aspectRatio: '9:16', stylePrompt: '', castPrompt: '',
  })

  assert.equal(prompts.length, 2)
  assert.match(prompts[0], /第 1 至 5 章/)
  assert.match(prompts[1], /第 6 至 6 章/)
  assert.match(prompts[1], /上一批最后状态/)
  assert.equal(result.plan.chapters.length, 6)
  assert.equal(result.plan.chapters[5].id, 'chapter-06')
})
