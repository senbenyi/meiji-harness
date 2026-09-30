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
 const { result, steps } = await recordSteps(() => checkContext.run({},() => generateEpisode({project,route,request:async ({ skill, user: prompt }) =>{
 calls++;if(calls===2)return 'FAIL\n结尾未承接';if(calls===4)return 'PASS'
 if(calls===3){assert.match(prompt,/结尾未承接/);assert.match(prompt,/初稿/)}
 return JSON.stringify({summary:calls===1?'初稿':'修订稿',durationSeconds:10})
 }})))
 assert.equal(calls,4);assert.equal(result.summary,'修订稿');assert.equal(result.check.passed,true)
 assert.deepEqual(steps.map(step => `${step.kind}:${step.target}:${step.verdict}`), ['generate:summary:null', 'review:summary:fail', 'revise:summary:null', 're_review:summary:pass'])
})
test('story package repairs once with language and original failure present',async()=>{
 let calls=0
 const result=await generateStoryPackage({project:{...episodeFixture(),outputLanguage:'en'},route,fetchImpl:async(_,options)=>{
 const body=JSON.parse(options.body);calls++;assert.match(body.messages[0].content,/本次生成语言：English/)
 if(calls===3)assert.match(body.messages[1].content,/缺少角色/)
 return Response.json({choices:[{message:{content:calls===2?'FAIL\n缺少角色':calls===4?'PASS':JSON.stringify(storyPackageFixture())}}]})
 }})
 assert.equal(calls,4);assert.equal(result.check.passed,true)
})
test('episode invalid JSON is not sent to semantic review or retried',async()=>{
 let calls=0
 await assert.rejects(generateEpisode({project:{...episodeFixture(),episodes:[]},route,request:async()=>{calls++;return '{bad'}}),/JSON/)
 assert.equal(calls,1)
})

test('character generation runs independent identity coverage review instead of accepting merged bodies', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++
    const payload = JSON.parse(options.body)
    if (calls % 2 === 0) {
      assert.match(payload.messages[1].content, /阶段：剧情整包/)
      assert.match(payload.messages[1].content, /意识的姓名不代表身体相同/)
      return Response.json({ choices: [{ message: { content: 'FAIL\n缺少新身体的独立角色卡' } }] })
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(storyPackageFixture(10)) } }] })
  })
  await checkContext.run({}, async () => {
    const result = await generateStoryPackage({ route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' }, project: { ...episodeFixture(), outputLanguage: 'zh-CN' } })
    assert.equal(result.characters.items.length, 1)
    assert.deepEqual(checkContext.getStore().validation, ['FAIL\n缺少新身体的独立角色卡'])
  })
  assert.equal(calls, 4)
})
