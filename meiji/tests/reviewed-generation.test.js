import test from 'node:test'
import assert from 'node:assert/strict'
import { runTextGeneration } from '../server/workers/text-generation-worker.js'

// Exercise the public worker while controlling generation/review responses.
async function generateWithSelfReview({ generate, review, canRevise }) {
  let original, verdict
  return runTextGeneration({ skill: 'test', instructions: '测试', canRevise, options: { project: { durationSeconds: 5 }, request: async skill => {
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
for (const verdict of ['', 'invalid', 'FAIL']) test(`invalid review does not trigger correction: ${verdict}`,async()=>{
 let count=0;await generateWithSelfReview({generate:async()=>{count++;return '稿'},review:async()=>verdict});assert.equal(count,1)
})
test('review and correction API errors stop without producing a semantic failure',async()=>{
 await assert.rejects(generateWithSelfReview({generate:async()=> '稿',review:async()=>{throw new Error('network')}}),/network/)
 await assert.rejects(generateWithSelfReview({generate:async correction=>{if(correction)throw new Error('network');return '稿'},review:async()=> 'FAIL\n原因'}),/network/)
})
test('seconds retry includes latest draft, original human opinion and failure then reviews again',async()=>{
 const calls=[];let generated=0;let reviewed=0
 const result=await generateShotSeconds({project:episodeFixture(),shotId:'S01',review:'保留声音',request:async(skill,prompt)=>{calls.push(prompt);return skill==='skill-gongyong-content-review' ? (++reviewed===1?'FAIL\n朝向不对':'PASS') : (++generated===1?'最新初稿':'修好朝向')}})
 assert.equal(calls.length,4);assert.match(calls[2],/最新初稿/);assert.match(calls[2],/朝向不对/);assert.match(calls[2],/保留声音/);assert.match(calls[3],/修好朝向/);assert.equal(result.items[0].seconds.check.passed,true)
})
test('invalid table syntax is never rewritten even on semantic FAIL',async()=>{
 let count=0;const out=await generateShots({project:episodeFixture(),request:async skill=>{count++;return skill==='skill-gongyong-content-review'?'FAIL\n标题错误':'{"items":[]}'}});assert.equal(count,2);assert.equal(out.failedOutput,'{"items":[]}')
})

test('second self-review sees task and newest output without prior failed draft or verdict', async () => {
  let generation = 0, reviews = 0
  await runTextGeneration({
    skill: 'test', instructions: '任务依据：向北走；人工意见：保持背影。旧基稿：OLD_BASE',
    reviewInstructions: '任务依据：向北走；人工意见：保持背影。',
    options: { project: { durationSeconds: 5 }, request: async (skill, prompt) => {
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
