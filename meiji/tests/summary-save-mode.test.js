import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { contentNode } from '../shared/drama-model.js'
import { materialize } from '../shared/episode-rules.js'
import { planRun } from '../shared/run-planner.js'
import { outlineFixture, storyRequest } from './fixtures/story-package.js'

test('展示摘要更新只影响展示节点，不清理大纲、镜头、每秒指令或成片', async t=>{
 const e=await setupModel(t),before=await e.read()
 await e.store.save(e.id,current=>({episodes:current.episodes.map(episode=>({...episode,summary:contentNode(episode.summary,'新的展示摘要',{passed:true,failures:[]})}))}))
 const after=await e.read()
 assert.equal(after.summary.content,'新的展示摘要');assert.deepEqual(after.plot.outline,before.plot.outline);assert.deepEqual(after.shots.items,before.shots.items);assert.deepEqual(after.assembly,before.assembly)
})
test('大纲生成和自审之后提取展示摘要，摘要没有自审或剧本回写步骤',async t=>{
 const e=await setupModel(t),plan=planRun(await e.read(),{to:'story',mode:'regenerate'})
 assert.deepEqual(plan.steps.map(step=>[step.kind,step.target]),[['generate','outline'],['review','outline'],['generate','summary']])
 const summary=plan.steps.at(-1);assert.equal(summary.branch,true);assert.deepEqual(summary.after,[plan.steps[1].id])
 assert.equal(plan.prereq.length,0)
})
test('摘要独立提取不创建新集，也不改变故事或时长',async t=>{
 const e=await setupModel(t),before=await e.read(),calls=[]
 await runOperation(e.op('summary',{mode:'regenerate'}),{home:e.home,request:async message=>{calls.push(message);return '{"summary":"展示用"}'}})
 const after=await e.read();assert.equal(calls.length,1);assert.equal(after.summary.content,'展示用');assert.equal(after.summary.outlineRevision,after.plot.outline.revision)
 assert.deepEqual(after.plot.outline,before.plot.outline);assert.deepEqual(after.shots.items,before.shots.items);assert.equal(after.durationSeconds,before.durationSeconds)
})
test('人工编辑故事小段允许覆盖原始资料且保存人工来源，不因旧摘要恢复剧情',async t=>{
 const e=await setupModel(t),outline=outlineFixture('按人工意见换成码头故事')
 await runOperation(e.op('outline-text',{outline}),{home:e.home,reviewContent:async input=>{assert.match(input.text,/码头故事/);return {passed:true,failures:[]}}})
 const after=await e.read();assert.deepEqual(after.plot.outline.content,outline);assert.equal(after.plot.outline.sourceMode,'manual');assert.equal(after.summary.content,null)
})
