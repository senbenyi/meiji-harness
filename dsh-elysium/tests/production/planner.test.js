import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlannerService } from '../../src/application/planning-service.js'

function scenesResponse() {
  return JSON.stringify({
    synopsis: '两名旧识在雨夜列车重逢并重新作出选择。',
    scenes: [{
      title: '雨夜重逢', summary: '两名旧识在雨夜列车重逢。', characters: ['甲', '乙'],
      location: '列车', timeOfDay: '夜晚', dialogueCount: 2, dialogueChars: 12,
      emotionStart: '紧张', emotionEnd: '释然', emotionIntensity: 6,
      notes: { spatial: '甲在左、乙在右', ambientSound: '列车行驶声和雨声' },
    }],
  })
}

function response(chapters = 3) {
  return JSON.stringify({
    synopsis: '两名旧识在雨夜列车重逢并重新作出选择。',
    castPrompt: '两名成年角色分开站立，中性背景，正面全身定妆。',
    chapters: Array.from({ length: chapters }, (_, chapterIndex) => ({
      title: `叙事阶段 ${chapterIndex + 1}`,
      summary: `阶段 ${chapterIndex + 1} 发生新的事件`,
      sceneIds: ['scene-01'],
      soundPrompt: `rain and train ambience with synchronized footsteps ${chapterIndex + 1}`,
      anchors: Array.from({ length: 6 }, (_, anchorIndex) => ({
        imagePrompt: `阶段 ${chapterIndex + 1} 的具体画面 ${anchorIndex + 1}，人物动作和道具状态均有变化`,
        motionPrompt: `人物完成动作 ${anchorIndex + 1}，镜头稳定推进`,
      })),
    })),
  })
}

test('uses the configured Qwen provider and returns six concrete anchors per chapter', async () => {
  const requests = []
  let call = 0
  const ctx = { llm: { async *stream(value) {
    requests.push(value)
    yield { type: 'text-delta', index: 0, text: call++ === 0 ? scenesResponse() : response() }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  const planner = createPlannerService(ctx)
  const result = await planner.plan({
    episodeId: 'episode-01', sourceText: '雨夜列车上的重逢。', targetDurationSec: 60,
    aspectRatio: '16:9', stylePrompt: '写实电影感', castPrompt: '',
  })

  assert.equal(requests[1].provider, 'qwen38-local')
  assert.equal(requests[1].model, 'qwen3.8-27b-video-prompt')
  assert.match(requests[0].messages[0].content[0].text, /第一阶段只忠实拆分故事/)
  assert.match(requests[1].messages[0].content[0].text, /16:9 横屏/)
  assert.match(requests[1].messages[0].content[0].text, /已审核场景拆解/)
  assert.equal(result.plan.source, 'producer-agent')
  assert.equal(result.script.scenes[0].notes.ambientSound, '列车行驶声和雨声')
  assert.equal(result.plan.chapters.length, 3)
  assert.match(result.plan.chapters[0].soundPrompt, /rain and train/)
  assert.equal(result.plan.chapters.every(chapter => chapter.anchors.length === 6), true)
  assert.equal(result.plan.chapters[0].anchors[0].role, 'start')
  assert.equal(result.plan.chapters[0].anchors[1].role, 'continuation')
})

test('uses a model routing change made after the planner service starts', async () => {
  let request
  let call = 0
  const config = { planner: { provider: 'first', model: 'model-a', maxTokens: 4096 } }
  const ctx = { llm: { async *stream(value) {
    request = value
    yield { type: 'text-delta', index: 0, text: call++ === 0 ? scenesResponse() : response(1) }
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
  let call = 0
  const ctx = { llm: { async *stream() {
    yield { type: 'reasoning-delta', index: 0, text: call++ === 0 ? scenesResponse() : response(1) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  const result = await createPlannerService(ctx).plan({
    episodeId: 'episode-reasoning', sourceText: '月球便利店。', targetDurationSec: 20,
  })

  assert.equal(result.plan.chapters.length, 1)
  assert.equal(result.plan.chapters[0].anchors.length, 6)
})

test('rejects malformed planner output instead of silently creating a fake draft', async () => {
  let call = 0
  const ctx = { llm: { async *stream() {
    yield { type: 'text-delta', index: 0, text: call++ === 0 ? scenesResponse() : '{"chapters":[]}' }
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
    const output = call++ === 0 ? scenesResponse() : response(call === 2 ? 5 : 1)
    yield { type: 'text-delta', index: 0, text: output }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  const result = await createPlannerService(ctx).plan({
    episodeId: 'episode-long', sourceText: '一段需要持续推进的长故事。', targetDurationSec: 120,
    aspectRatio: '9:16', stylePrompt: '', castPrompt: '',
  })

  assert.equal(prompts.length, 3)
  assert.match(prompts[1], /第 1 至 5 章/)
  assert.match(prompts[2], /第 6 至 6 章/)
  assert.match(prompts[2], /上一批最后状态/)
  assert.equal(result.plan.chapters.length, 6)
  assert.equal(result.plan.chapters[5].id, 'chapter-06')
})
