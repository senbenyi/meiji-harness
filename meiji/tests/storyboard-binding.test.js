import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { generateShotStoryboard } from '../server/flow/operations/shot-operations.js'
import { runOperation } from '../server/flow/operations/run-operation.js'
import { recordStore } from '../server/data/task-store.js'
import { h3PromptFailures } from '../shared/video-rules.js'
import { filmSubmit } from '../server/flow/operations/video-operations.js'
import { buildEditedContentReview } from '../server/prompts/text-prompts.js'
import { previewPrompts } from '../server/prompts/preview-prompts.js'

test('program binding uses markers and freezes picture order without LLM requests',async()=>{
 const project=episodeFixture();project.plot.characters.items[0].image.content={localPath:'/portrait.png'};project.plot.scenes.items[0].image.content={localPath:'/scene.png'}
 const item=(await generateShotStoryboard({project,shotId:'S01',request:()=>assert.fail('no LLM')}))[0]
 assert.deepEqual(item.entityIds,['C01','E01']);assert.deepEqual(item.referenceSnapshot.map(r=>r.url),['/portrait.png','/scene.png'])
 assert.deepEqual(h3PromptFailures(item.prompt.text,item.referenceSnapshot,item.video),[])
 project.plot.characters.items[0].image.content.localPath='/new.png'
 assert.equal(item.referenceSnapshot[0].url,'/portrait.png')
 assert.throws(()=>filmSubmit(project,item,{}),/参考素材已变化/)
})
test('rebinding uses edited structured seconds rather than stale final prompt',async()=>{
 const project=episodeFixture();project.shots.items[0].seconds.content.beats[0].action='【旅人|C01】朝东行走'
 const item=(await generateShotStoryboard({project,shotId:'S01'}))[0]
 assert.match(item.prompt.text,/朝东行走/);assert.ok(item.sourceMap.some(s=>s.beatId==='B01'))
})
test('storyboard operations plan only program generation and review',async t=>{
 const e=await setupModel(t)
 for(const action of ['shot-storyboard','storyboard-bind']){
  await runOperation(e.op(action,{track:'S01'}),{home:e.home,operationId:action})
  const task=await recordStore(e.home,e.id).read('tasks',action)
  assert.equal(task.status,'completed');assert.deepEqual(task.steps.map(s=>s.kind),['generate','review'])
  assert.ok(task.steps.every(s=>!s.unplanned));assert.deepEqual(task.steps[1].attempts.map(a=>a.label),['程序审核'])
 }
})
test('manual final text still receives semantic review against selected seconds',()=>{
 const project=episodeFixture();project.summary.content='UNRELATED_SUMMARY'
 const message=buildEditedContentReview({project,stage:'storyboard',shotId:'S01'},'EDITED')
 assert.match(message.user,/【旅人\|C01】朝北行走/);assert.match(message.user,/EDITED/)
 assert.doesNotMatch(message.user,/UNRELATED_SUMMARY/)
})
test('preview renders actual compiler output and exposes no fictional model requests',()=>{
 const project=episodeFixture()
 const preview=previewPrompts({stage:'storyboard',root:project,view:project,nodeKey:'storyboard:S01'})
 assert.match(preview.generate.user[0].text,/integrated_multimodal_description/)
 assert.equal(preview.review,null);assert.equal(preview.revise,null)
})
test('unknown marker is rejected rather than guessed, malformed H3 cannot submit',async()=>{
 const project=episodeFixture();project.shots.items[0].seconds.content.beats[0].action='【旅人|C99】走'
 await assert.rejects(generateShotStoryboard({project,shotId:'S01'}),/未知实体/)
 const item={...project.shots.items[0].storyboard.content,id:'S01',video:'reference',referenceSnapshot:[{url:'/portrait.png'}]}
 assert.throws(()=>filmSubmit(project,item,{}),/H3 reference/)
})
