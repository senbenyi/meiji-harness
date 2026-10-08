import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { outlineFixture, outlineResponse } from './fixtures/story-package.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import { runStore } from '../server/data/run-store.js'
import { historyStore } from '../server/data/history-store.js'

test('大纲失败审核与最新发布版本绑定，保留最新失败稿',async t=>{
 const e=await setupModel(t)
 await assert.rejects(runOperation(e.op('story',{mode:'regenerate'}),{home:e.home,request:async message=>message.skill==='review'?reviewFail('因果错误'):outlineResponse('最新失败稿')}),/自审未通过/)
 const current=await e.read(),run=await latestRun(e.home,e.id,'outline'),store=runStore(e.home,e.id)
 assert.equal(current.plot.outline.check.passed,false);assert.match(current.plot.outline.content.故事小段,/最新失败稿/)
 const artifacts=await store.listRecords('artifacts');assert.ok(artifacts.some(item=>item.target==='outline'&&item.published));assert.ok(run.steps.some(step=>step.kind==='re_review'))
})
test('审核断网保留已保存大纲，自动摘要尚未执行',async t=>{
 const e=await setupModel(t)
 await assert.rejects(runOperation(e.op('story',{mode:'regenerate'}),{home:e.home,request:async message=>{if(message.skill==='review')throw Error('审核断网');return outlineResponse('已经保存')}}),/审核断网/)
 const current=await e.read();assert.match(current.plot.outline.content.故事小段,/已经保存/);assert.notEqual(current.plot.outline.check.passed,true)
})
test('人工编辑大纲保存并留下项目事件，独立审核不要求恢复展示摘要',async t=>{
 const e=await setupModel(t),outline=outlineFixture('人工换成渡口')
 await runOperation(e.op('outline-text',{outline}),{home:e.home,reviewContent:async()=>({passed:true,failures:[]})})
 const current=await e.read();assert.deepEqual(current.plot.outline.content,outline);assert.equal(current.plot.outline.sourceMode,'manual')
 assert.equal((await historyStore(e.home,e.id).list('events')).at(-1).type,'outline-text')
})
test('新增及编辑剧集只保存时长与要求，不能人工覆盖展示摘要',async t=>{
 const e=await setupModel(t),before=await e.read()
 await runOperation(e.op('episode-edit',{fields:{durationSeconds:10,requirements:'保留结尾',summary:'不应保存'}}),{home:e.home})
 assert.equal((await e.read()).summary.content,before.summary.content)
 await runOperation(e.op('episode-add',{fields:{durationSeconds:38,requirements:'下一集调查'}}),{home:e.home})
 const root=await e.store.read(e.id);assert.equal(root.episodes[0].durationSeconds,38);assert.equal(root.episodes[0].storyRequirements,'下一集调查')
})
