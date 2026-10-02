import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateEpisode } from '../server/flow/operations/project-operations.js'
import { generateStoryPackage } from '../server/flow/operations/story-text-operations.js'
import { episodeFixture } from './fixtures/model.js'
import { storyPackageFixture, outlineFixture } from './fixtures/story-package.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { recordSteps } from './fixtures/steps.js'
const route = { baseUrl: 'https://test.local', apiKey: 'test', model: 'test' }

test('episode generation repairs once and records both reviews',async()=>{
 const project = {...episodeFixture(), episodes: []};let calls=0
 const { result, steps } = await recordSteps(() => checkContext.run({},() => generateEpisode({project,route,referenceDurationSeconds:10,request:async ({ skill, user: prompt }) =>{
 calls++;if(calls===2)return reviewFail('结尾未承接');if(calls===4)return reviewPass
 if(calls===3){assert.match(prompt,/结尾未承接/);assert.match(prompt,/初稿/)}
 return JSON.stringify({summary:calls===1?'初稿':'修订稿',durationSeconds:10})
 }})))
 assert.equal(calls,4);assert.equal(result.summary,'修订稿');assert.equal(result.check.passed,true)
 assert.deepEqual(steps.map(step => `${step.kind}:${step.target}:${step.verdict}`), ['generate:summary:null', 'review:summary:fail', 'revise:summary:null', 're_review:summary:pass'])
})
test('story outline repairs once before extracting cards from the final outline', async () => {
 const fixture = storyPackageFixture()
 const replies = ['初稿', reviewFail('因果不完整'), outlineFixture('修订后最终大纲','en'), reviewPass, JSON.stringify(fixture.characters), reviewPass, JSON.stringify(fixture.scenes), reviewPass, JSON.stringify(fixture.props), reviewPass]
 let calls=0
 const { result, steps }=await recordSteps(() => generateStoryPackage({project:{...episodeFixture(),outputLanguage:'en'},route,request:async message=>{
   calls++
   if(calls===3) { assert.match(message.user,/因果不完整/); assert.match(message.user,/初稿/) }
   if(calls>=5) { assert.match(message.user,/修订后最终大纲/); assert.doesNotMatch(message.user,/初稿/) }
   return replies.shift()
 }}))
 assert.equal(calls,10); assert.equal(result.check.passed,true)
 assert.deepEqual(steps.map(step=>`${step.kind}:${step.target}`), ['generate:outline','review:outline','revise:outline','re_review:outline','generate:characters','review:characters','generate:scenes','review:scenes','generate:props','review:props'])
})
test('episode invalid JSON fails program review and receives one revision',async()=>{
 let calls=0
 await assert.rejects(generateEpisode({project:{...episodeFixture(),episodes:[]},route,request:async({skill})=>{calls++;return skill==='review'?reviewPass:'{bad'}}),/JSON/)
 assert.equal(calls,4)
})

test('character extraction independently reviews body coverage and stops scene extraction on failure', async () => {
  const fixture = storyPackageFixture()
  const replies = [outlineFixture('现代旅人穿越到古代武松身体，两个身体均实际出镜。'), reviewPass, JSON.stringify(fixture.characters), reviewFail('缺少新身体的独立角色卡'), JSON.stringify(fixture.characters), reviewFail('缺少新身体的独立角色卡')]
  let calls = 0
  await checkContext.run({}, async () => {
    const result = await generateStoryPackage({ route, project: episodeFixture(), request: async message => {
      calls++
      if ([4,6].includes(calls)) {
        assert.ok(message.user.includes(JSON.stringify(fixture.characters)))
        assert.match(message.system, /剧情明确进入另一个身体（穿越、夺舍、变身等）后，没有为新身体单独建卡/)
      }
      return replies.shift()
    } })
    assert.equal(result.characters.items.length, 1)
    assert.equal(result.checks.outline.passed, true)
    assert.equal(result.checks.characters.passed, false)
    assert.equal(result.checks.scenes.passed, null)
    assert.deepEqual(checkContext.getStore().validation, ['位置：本次内容；原因：缺少新身体的独立角色卡；修正要求：修正上述问题'])
  })
  assert.equal(calls, 6)
})
