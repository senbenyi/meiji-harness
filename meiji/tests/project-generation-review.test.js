import test from 'node:test'
import assert from 'node:assert/strict'
import { generateEpisode, generateStoryPackage } from '../server/generate/story.js'
import { episodeFixture } from './fixtures/model.js'
import { storyPackageFixture } from './fixtures/story-package.js'
import { checkContext } from '../server/data/self-checks.js'
const route = { baseUrl: 'https://test.local', apiKey: 'test', model: 'test' }

test('episode generation repairs once and records both reviews',async()=>{
 const project = {...episodeFixture(), episodes: []};let calls=0
 await checkContext.run({},async()=>{
 const result=await generateEpisode({project,route,request:async(skill,prompt)=>{
 calls++;if(calls===2)return 'FAIL\n结尾未承接';if(calls===4)return 'PASS'
 if(calls===3){assert.match(prompt,/结尾未承接/);assert.match(prompt,/初稿/)}
 return JSON.stringify({summary:calls===1?'初稿':'修订稿',durationSeconds:10})
 }})
 assert.equal(calls,4);assert.equal(result.summary,'修订稿');assert.equal(result.check.passed,true);assert.equal(checkContext.getStore().reviewHistory.length,2)
 })
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
