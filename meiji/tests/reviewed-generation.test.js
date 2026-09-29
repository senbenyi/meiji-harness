import test from 'node:test'
import assert from 'node:assert/strict'
import { runTextSteps } from '../server/generate/text-steps.js'
import { recordSteps } from './fixtures/steps.js'
import { buildTextPrompts } from '../server/prompts/text-prompts.js'

// Exercise the public worker while controlling generation/review responses.
async function generateWithSelfReview({ generate, review, canRevise }) {
  let original, verdict
  return runTextSteps({ prompts: buildTextPrompts({ skill: 'skill-gailan-episode-generate', project: {}, instructions: '测试' }), canRevise, options: { project: { durationSeconds: 5 }, request: async ({ skill }) => {
    if (skill === 'skill-gongyong-content-review') { verdict = await review(original); return verdict }
    original = await generate(original === undefined ? undefined : { text: original, reviewText: verdict })
    return original
  } } })
}
import { generateShotSeconds, generateShots } from '../server/generate/shot-text.js'
import { episodeFixture } from './fixtures/model.js'

test('shared executor corrects once and reviews the new result', async () => {
 const calls = []
 const result = await generateWithSelfReview({ generate: async correction => { calls.push(correction); return correction ? '修订稿' : '初稿' }, review: async text => text === '初稿' ? 'FAIL\n朝向错误' : 'PASS' })
 assert.equal(calls.length, 2); assert.deepEqual(calls[1], { text: '初稿', reviewText: 'FAIL\n朝向错误' }); assert.equal(result.text, '修订稿'); assert.equal(result.check.passed, true)
})
test('second failure stops; no third generation', async () => {
 let count=0
 const result=await generateWithSelfReview({generate:async()=>`稿${++count}`,review:async()=> 'FAIL\n错误'})
 assert.equal(count,2);assert.equal(result.text,'稿2');assert.equal(result.check.passed,false)
})
// 审核必须返回 PASS 或「FAIL 原因」；其它格式视为接口错误，不触发修订。
for (const verdict of ['', 'invalid', 'FAIL']) test(`invalid review is a format error and does not trigger correction: ${verdict}`,async()=>{
 let count=0;await assert.rejects(generateWithSelfReview({generate:async()=>{count++;return '稿'},review:async()=>verdict}),/审核返回格式错误/);assert.equal(count,1)
})
test('review and correction API errors stop without producing a semantic failure',async()=>{
 await assert.rejects(generateWithSelfReview({generate:async()=> '稿',review:async()=>{throw new Error('network')}}),/network/)
 await assert.rejects(generateWithSelfReview({generate:async correction=>{if(correction)throw new Error('network');return '稿'},review:async()=> 'FAIL\n原因'}),/network/)
})
test('seconds retry includes latest draft, original human opinion and failure then reviews again',async()=>{
 const calls=[];let generated=0;let reviewed=0
 const result=await generateShotSeconds({project:episodeFixture(),shotId:'S01',review:'保留声音',request:async ({ skill, user: prompt }) =>{calls.push(prompt);return skill==='skill-gongyong-content-review' ? (++reviewed===1?'FAIL\n朝向不对':'PASS') : (++generated===1?'最新初稿':'修好朝向')}})
 assert.equal(calls.length,4);assert.match(calls[2],/最新初稿/);assert.match(calls[2],/朝向不对/);assert.match(calls[2],/保留声音/);assert.match(calls[3],/修好朝向/);assert.equal(result.items[0].seconds.check.passed,true)
})
test('invalid table syntax fails before review and is never rewritten',async()=>{
 let count=0;await assert.rejects(generateShots({project:episodeFixture(),request:async ({ skill }) =>{count++;return skill==='skill-gongyong-content-review'?'FAIL\n标题错误':'{"items":[]}'}}),/镜头表需按/);assert.equal(count,1)
})

test('second self-review sees task and newest output without prior failed draft or verdict', async () => {
  let generation = 0, reviews = 0
  await runTextSteps({
    prompts: buildTextPrompts({ skill: 'skill-gailan-episode-generate', project: {}, instructions: '任务依据：向北走；人工意见：保持背影。旧基稿：OLD_BASE',
    reviewInstructions: '任务依据：向北走；人工意见：保持背影。' }),
    options: { project: { durationSeconds: 5 }, request: async ({ skill, user: prompt }) => {
      if (skill !== 'skill-gongyong-content-review') {
        generation++
        if (generation === 2) { assert.match(prompt, /FAILED_DRAFT/); assert.match(prompt, /OLD_VERDICT/) }
        return generation === 1 ? 'FAILED_DRAFT' : 'LATEST_OUTPUT'
      }
      reviews++
      assert.match(prompt, /向北走/); assert.match(prompt, /保持背影/)
      assert.doesNotMatch(prompt, /OLD_BASE|OLD_VERDICT|【本轮定向修订】/)
      if (reviews === 2) { assert.match(prompt, /LATEST_OUTPUT/); assert.doesNotMatch(prompt, /FAILED_DRAFT/) }
      return reviews === 1 ? 'FAIL OLD_VERDICT' : 'PASS'
    } },
  })
  assert.equal(reviews, 2)
})

test('text steps record generate, review and, only after a failed review, revise and re-review', async () => {
  const plan = ['generate', 'review', 'revise', 're_review'].map(kind => ({ id: kind, kind, target: 'summary', status: 'pending', verdict: null, reasons: [], attempts: [], inputs: [], outputs: [] }))
  const failed = await recordSteps(() => generateWithSelfReview({ generate: async correction => correction ? '修订稿' : '初稿', review: async text => text === '初稿' ? 'FAIL\n朝向错误' : 'PASS' }), structuredClone(plan))
  // 未传 target 时步骤不对应到计划，追加在后面；计划步骤保持未执行。
  assert.deepEqual(failed.steps.filter(step => step.unplanned).map(step => `${step.kind}:${step.verdict}`), ['generate:null', 'review:fail', 'revise:null', 're_review:pass'])
  const passed = await recordSteps(() => runTextSteps({ target: 'summary', prompts: buildTextPrompts({ skill: 'skill-gailan-episode-generate', project: {}, instructions: '测试' }), options: { project: { durationSeconds: 5 },
    request: async ({ skill }) => skill === 'skill-gongyong-content-review' ? 'PASS' : '稿' } }), structuredClone(plan))
  assert.deepEqual(passed.steps.map(step => `${step.kind}:${step.status}:${step.verdict}`), ['generate:completed:null', 'review:completed:pass', 'revise:pending:null', 're_review:pending:null'])
  assert.ok(passed.steps.every(step => !step.unplanned))
})
