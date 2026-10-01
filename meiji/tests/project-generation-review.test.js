import test from 'node:test'
import assert from 'node:assert/strict'
import { generateEpisode, generateStoryPackage } from '../server/generate/story.js'
import { episodeFixture } from './fixtures/model.js'
import { storyPackageFixture } from './fixtures/story-package.js'
import { checkContext } from '../server/data/operation-context.js'
import { recordSteps } from './fixtures/steps.js'
const route = { baseUrl: 'https://test.local', apiKey: 'test', model: 'test' }

test('episode generation repairs once and records both reviews',async()=>{
 const project = {...episodeFixture(), episodes: []};let calls=0
 const { result, steps } = await recordSteps(() => checkContext.run({},() => generateEpisode({project,route,referenceDurationSeconds:10,request:async ({ skill, user: prompt }) =>{
 calls++;if(calls===2)return 'FAIL\n结尾未承接';if(calls===4)return 'PASS'
 if(calls===3){assert.match(prompt,/结尾未承接/);assert.match(prompt,/初稿/)}
 return JSON.stringify({summary:calls===1?'初稿':'修订稿',durationSeconds:10})
 }})))
 assert.equal(calls,4);assert.equal(result.summary,'修订稿');assert.equal(result.check.passed,true)
 assert.deepEqual(steps.map(step => `${step.kind}:${step.target}:${step.verdict}`), ['generate:summary:null', 'review:summary:fail', 'revise:summary:null', 're_review:summary:pass'])
})
test('story outline repairs once before extracting cards from the final outline', async () => {
 const fixture = storyPackageFixture()
 const replies = [JSON.stringify({outline:'初稿'}), 'FAIL\n因果不完整', JSON.stringify({outline:'修订后最终大纲'}), 'PASS', JSON.stringify(fixture.characters), 'PASS', JSON.stringify(fixture.scenes), 'PASS']
 let calls=0
 const { result, steps }=await recordSteps(() => generateStoryPackage({project:{...episodeFixture(),outputLanguage:'en'},route,request:async message=>{
   calls++
   if(calls===3) { assert.match(message.user,/因果不完整/); assert.match(message.user,/初稿/) }
   if(calls>=5) { assert.match(message.user,/修订后最终大纲/); assert.doesNotMatch(message.user,/初稿/) }
   return replies.shift()
 }}))
 assert.equal(calls,8); assert.equal(result.check.passed,true)
 assert.deepEqual(steps.map(step=>`${step.kind}:${step.target}`), ['generate:outline','review:outline','revise:outline','re_review:outline','generate:characters','review:characters','generate:scenes','review:scenes'])
})
test('episode invalid JSON is not sent to semantic review or retried',async()=>{
 let calls=0
 await assert.rejects(generateEpisode({project:{...episodeFixture(),episodes:[]},route,request:async()=>{calls++;return '{bad'}}),/JSON/)
 assert.equal(calls,1)
})

test('character extraction independently reviews body coverage and stops scene extraction on failure', async () => {
  const fixture = storyPackageFixture()
  const replies = [JSON.stringify({outline:'现代旅人穿越到古代武松身体，两个身体均实际出镜。'}), 'PASS', JSON.stringify(fixture.characters), 'FAIL\n缺少新身体的独立角色卡', JSON.stringify(fixture.characters), 'FAIL\n缺少新身体的独立角色卡']
  let calls = 0
  await checkContext.run({}, async () => {
    const result = await generateStoryPackage({ route, project: episodeFixture(), request: async message => {
      calls++
      if ([4,6].includes(calls)) {
        assert.match(message.user, /阶段：人物提取/)
        assert.match(message.system, /意识的姓名不代表身体相同/)
      }
      return replies.shift()
    } })
    assert.equal(result.characters.items.length, 1)
    assert.equal(result.checks.outline.passed, true)
    assert.equal(result.checks.characters.passed, false)
    assert.equal(result.checks.scenes.passed, null)
    assert.deepEqual(checkContext.getStore().validation, ['FAIL\n缺少新身体的独立角色卡'])
  })
  assert.equal(calls, 6)
})
