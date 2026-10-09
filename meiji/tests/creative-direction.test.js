import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { reviewPass } from './fixtures/review-result.js'
import { outlineFixture } from './fixtures/story-package.js'
import { projectStore } from '../server/data/project-store.js'
import { materialize } from '../shared/episode-rules.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { creativeDirection } from '../shared/script-assembly.js'

test('自由模式直接生成多集故事，修改方向仅影响后续新集，不依赖摘要或回写剧本', async t=>{
 const home=await tempHome(t),store=projectStore(home),project=await store.create({mode:'free',premise:'寻亲冒险',title:'寻亲'}),calls=[]
 const request=async message=>{calls.push(message);return message.skill==='review'?reviewPass:JSON.stringify(outlineFixture('本集完整剧情','zh-CN',30))}
 for(let number=1;number<=2;number++) {
  await runOperation({action:'story',projectId:project.id,referenceDurationSeconds:30},{home,request})
  const root=await store.read(project.id),current=materialize(root,root.episodes[0].id)
  assert.equal(current.episodeNumber,number);assert.match(calls.at(-2).user,/【AI 创作方向】/)
  assert.equal(root.script,'');assert.ok(current.plot.outline.content)
 }
 const before=await store.read(project.id)
 await runOperation({action:'premise-edit',projectId:project.id,text:'NEW_DIRECTION 海岛寻亲'},{home})
 await runOperation({action:'story',projectId:project.id,referenceDurationSeconds:30,requirements:'先调查码头'},{home,request})
 assert.match(calls.at(-2).user,/NEW_DIRECTION/);assert.match(calls.at(-2).user,/先调查码头/)
 const after=await store.read(project.id);for(const old of before.episodes)assert.deepEqual(after.episodes.find(item=>item.id===old.id),old)
})
test('大纲生成、修改、审核与自动修订持续使用自由方向；剧本模式不注入隐藏方向',()=>{
 for(const mode of ['free','script']) {
  const project={mode,premise:'DIRECTION_ONLY',script:'SCRIPT_ONLY',episodeNumber:2,plot:{outline:{content:outlineFixture('基稿')}},summary:{content:'DISPLAY_ONLY'}}
  const prompts=buildStoryPrompts(project)
  for(const message of [prompts.generation,prompts.review('待审正文'),prompts.revision('基稿','意见')]) {
   assert.match(message.user,mode==='free'?/DIRECTION_ONLY/:/SCRIPT_ONLY/)
   if(mode==='script')assert.doesNotMatch(message.user,/DIRECTION_ONLY/)
   assert.doesNotMatch(message.user,/DISPLAY_ONLY/)
  }
  assert.equal(creativeDirection(project),mode==='free'?'DIRECTION_ONLY':'')
 }
})
test('人工编辑故事以当前人工基稿为准，不强制恢复原始剧本事件',()=>{
 const project={mode:'script',script:'原剧情',plot:{outline:{sourceMode:'manual',content:outlineFixture('修改后剧情')}},summary:{content:'过期摘要'}}
 const prompts=checkContext.run({generationMode:'modify',review:'保留人工修改'},()=>buildStoryPrompts(project))
 assert.match(prompts.generation.user,/人工编辑版本/);assert.match(prompts.review('修改后剧情').user,/不恢复人工删改内容/)
})
