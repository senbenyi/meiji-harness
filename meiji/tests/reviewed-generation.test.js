import { secondsResponse } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runTextSteps } from '../server/runtime/text-generation.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { recordSteps } from './fixtures/steps.js'
import { buildTextPrompts } from '../server/prompts/text-prompts.js'

// Exercise the public worker while controlling generation/review responses.
async function generateWithSelfReview({ generate, review, canRevise }) {
  let original, verdict
  return runTextSteps({ prompts: buildTextPrompts({ skill: 'episode', project: {}, instructions: '测试' }), canRevise, options: { project: { durationSeconds: 5 }, request: async ({ skill }) => {
    if (skill === 'review') { verdict = await review(original); return verdict }
    original = await generate(original === undefined ? undefined : { text: original, reviewText: verdict })
    return original
  } } })
}
import { generateShotSeconds, generateShots } from '../server/flow/operations/shot-operations.js'
import { episodeFixture } from './fixtures/model.js'

test('shared executor corrects once and reviews the new result', async () => {
 const calls = []
 const result = await generateWithSelfReview({ generate: async correction => { calls.push(correction); return correction ? '修订稿' : '初稿' }, review: async text => text === '初稿' ? reviewFail('朝向错误') : reviewPass })
 assert.equal(calls.length, 2); assert.deepEqual(calls[1], { text: '初稿', reviewText: reviewFail('朝向错误') }); assert.equal(result.text, '修订稿'); assert.equal(result.check.passed, true)
})
test('second failure stops; no third generation', async () => {
 let count=0
 const result=await generateWithSelfReview({generate:async()=>`稿${++count}`,review:async()=> reviewFail('错误')})
 assert.equal(count,2);assert.equal(result.text,'稿2');assert.equal(result.check.passed,false)
})
// 审核必须返回统一 JSON；旧文本和其它格式属于执行错误，不触发修订。
for (const verdict of ['', 'invalid', 'FAIL']) test(`invalid review is a format error and does not trigger correction: ${verdict}`,async()=>{
 let count=0;await assert.rejects(generateWithSelfReview({generate:async()=>{count++;return '稿'},review:async()=>verdict}),/审核返回格式错误/);assert.equal(count,1)
})
test('review and correction API errors stop without producing a semantic failure',async()=>{
 await assert.rejects(generateWithSelfReview({generate:async()=> '稿',review:async()=>{throw new Error('network')}}),/network/)
 await assert.rejects(generateWithSelfReview({generate:async correction=>{if(correction)throw new Error('network');return '稿'},review:async()=> reviewFail('原因')}),/network/)
})
test('seconds retry includes latest draft, original human opinion and failure then reviews again',async()=>{
 const calls=[];let generated=0;let reviewed=0
 const result=await generateShotSeconds({project:episodeFixture(),shotId:'S01',review:'保留声音',request:async ({ skill, user: prompt }) =>{calls.push(prompt);return skill==='review' ? (++reviewed===1?reviewFail('朝向不对'):reviewPass) : secondsResponse([['S01',5,++generated===1?'最新初稿':'修好朝向']])}})
 assert.equal(calls.length,4);assert.match(calls[2],/最新初稿/);assert.match(calls[2],/朝向不对/);assert.match(calls[2],/保留声音/);assert.match(calls[3],/修好朝向/);assert.equal(result.items[0].seconds.check.passed,true)
})
test('invalid table syntax is reviewed and revised once',async()=>{
 let count=0;await assert.rejects(generateShots({project:episodeFixture(),request:async ({ skill }) =>{count++;return skill==='review'?reviewFail('标题错误'):'{"items":[]}'}}),/镜头表需按/);assert.equal(count,4)
})

test('summary re-review compares the current revision base and opinion without restoring older source', async () => {
  let generation = 0, reviews = 0
  await runTextSteps({
    prompts: buildTextPrompts({ skill: 'episode', project: {}, instructions: { task: '任务依据：向北走；人工意见：保持背影。旧基稿：OLD_BASE',
    review: '任务依据：向北走；人工意见：保持背影。' } }),
    options: { project: { durationSeconds: 5 }, request: async ({ skill, user: prompt }) => {
      if (skill !== 'review') {
        generation++
        if (generation === 2) { assert.match(prompt, /FAILED_DRAFT/); assert.match(prompt, /OLD_VERDICT/) }
        return generation === 1 ? 'FAILED_DRAFT' : 'LATEST_OUTPUT'
      }
      reviews++
      assert.match(prompt, /向北走/); assert.match(prompt, /保持背影/)
      assert.doesNotMatch(prompt, /OLD_BASE|【本轮定向修订】/)
      if (reviews === 1) assert.doesNotMatch(prompt, /OLD_VERDICT|【修订基稿/)
      if (reviews === 2) {
        assert.match(prompt, /【修订基稿.*FAILED_DRAFT/s)
        assert.match(prompt, /【本轮修订意见】[\s\S]*OLD_VERDICT/)
        assert.match(prompt, /【本次待审内容】\nLATEST_OUTPUT/)
      }
      return reviews === 1 ? reviewFail('OLD_VERDICT') : reviewPass
    } },
  })
  assert.equal(reviews, 2)
})

test('text steps record generate, review and, only after a failed review, revise and re-review', async () => {
  const plan = ['generate', 'review', 'revise', 're_review'].map(kind => ({ id: kind, kind, target: 'summary', status: 'pending', verdict: null, reasons: [], attempts: [], inputs: [], outputs: [] }))
  const failed = await recordSteps(() => generateWithSelfReview({ generate: async correction => correction ? '修订稿' : '初稿', review: async text => text === '初稿' ? reviewFail('朝向错误') : reviewPass }), structuredClone(plan))
  // 未传 target 时步骤不对应到计划，追加在后面；计划步骤保持未执行。
  assert.deepEqual(failed.steps.filter(step => step.unplanned).map(step => `${step.kind}:${step.verdict}`), ['generate:null', 'review:fail', 'revise:null', 're_review:pass'])
  const passed = await recordSteps(() => runTextSteps({ target: 'summary', prompts: buildTextPrompts({ skill: 'episode', project: {}, instructions: '测试' }), options: { project: { durationSeconds: 5 },
    request: async ({ skill }) => skill === 'review' ? reviewPass : '稿' } }), structuredClone(plan))
  assert.deepEqual(passed.steps.map(step => `${step.kind}:${step.status}:${step.verdict}`), ['generate:completed:null', 'review:completed:pass', 'revise:pending:null', 're_review:pending:null'])
  assert.ok(passed.steps.every(step => !step.unplanned))
})

test('independent review does not receive stale correction text as a new instruction', async () => {
  const { buildReviewPrompt } = await import('../server/prompts/text-prompts.js')
  const { runTextRequest } = await import('../server/gateway/model-gateway.js')
  await checkContext.run({ review: 'STALE_ALREADY_FIXED' }, async () => {
    await runTextRequest(buildReviewPrompt({ skill: 'outline', project: {}, instructions: '本次任务' }, JSON.stringify({ outline: '', characters: { items: [] }, scenes: { items: [] } })), {
      route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' },
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body)
        assert.doesNotMatch(payload.messages[1].content, /STALE_ALREADY_FIXED/)
        assert.match(payload.messages[1].content, /阶段：剧情大纲/)
        return Response.json({ choices: [{ message: { content: reviewPass } }] })
      },
    })
  })
})

test('existing text is reviewed without generation and a disabled revision keeps the failed draft', async () => {
  const calls = []
  const result = await runTextSteps({ initialText: '已有草稿', canRevise: () => false,
    prompts: { generation: { skill: 'episode' }, review: text => ({ skill: 'review', user: text }), revision: () => { throw new Error('不应修订') } },
    options: { request: async message => { calls.push(message.user); return reviewFail('需要用户补充事实') } },
  })
  assert.deepEqual(calls, ['已有草稿'])
  assert.equal(result.text, '已有草稿')
  assert.equal(result.check.passed, false)
})

test('cancellation after generation prevents review and revision requests', async () => {
  const controller = new AbortController(), calls = []
  await assert.rejects(runTextSteps({
    prompts: { generation: { skill: 'episode' }, review: text => ({ skill: 'review', user: text }), revision: () => { throw new Error('不应修订') } },
    options: { signal: controller.signal, request: async message => { calls.push(message.skill); controller.abort(); return '已生成草稿' } },
  }), { name: 'AbortError' })
  assert.deepEqual(calls, ['episode'])
})
