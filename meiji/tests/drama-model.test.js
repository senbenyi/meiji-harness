import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { projectStore, revisionStore } from '../server/data/projects.js'
import { blankEpisode, materialize, scopeProjects } from '../server/data/episodes.js'
import { runOperation } from '../server/flow/operations/run.js'
import { generateShots, generateShotSeconds, generateShotStoryboard } from '../server/generate/shot-text.js'
import { storyPackageFixture } from './fixtures/story-package.js'
import { node, shotModel, begin, finish, saveReview, assertDrama, allNodes, contentNode } from '../shared/drama-model.js'
import { migrateProject } from '../scripts/migrate-model.js'
import { referenceReport } from '../client/storyboard-references.js'
async function setup(t) {
 const home=await mkdtemp('/tmp/meiji-model-');t.after(()=>rm(home,{recursive:true,force:true}))
 const store=projectStore(home), p=await store.create({title:'测试剧',summary:'本剧摘要'}), episode=blankEpisode({summary:'旅人进入庭院',durationSeconds:10})
 await store.save(p.id,{episodes:[episode]})
 return {home,store,id:p.id,episodeId:episode.id, op(action,extra={}){return {action,projectId:p.id,episodeId:episode.id,...extra}}}
}
const requestFor = text => async ({ skill }) =>skill==='review'?'PASS':text
async function throughShots(t) {
 const env=await setup(t)
 await runOperation(env.op('outline'),{home:env.home,generateStoryPackage:async()=>({...storyPackageFixture(10),check:{passed:true,failures:[]}})})
 await runOperation(env.op('shots'),{home:env.home,generateShots:opts=>generateShots({...opts,request:requestFor('## S01 / 5s\n旅人从南向北走进庭院。\n\n## S02 / 5s\n旅人停在门边。')})})
 return env
}
test('canonical model flows through plot, shots, seconds, storyboard and manual recheck',async t=>{
 const e=await throughShots(t)
 await runOperation(e.op('shot-seconds',{track:'S01'}),{home:e.home,generateShotSeconds:opts=>generateShotSeconds({...opts,request:requestFor('0–5s：朝北行走，摄影机在人物身后。')})})
 await runOperation(e.op('shot-storyboard',{track:'S01'}),{home:e.home,generateShotStoryboard:opts=>generateShotStoryboard({...opts,request:requestFor('summary: 旅人走进庭院\ndetailed_description: 朝北行走，摄影机在人物身后。')})})
 let p=await e.store.read(e.id), shot=p.episodes[0].shots.items[0]
 assert.equal(shot.seconds.status,'passed');assert.equal(shot.storyboard.status,'passed');assert.equal(shot.pencil.status,'not-generated')
 await runOperation(e.op('storyboard-text',{track:'S01',originalText:shot.storyboard.content.prompt.text,text:'修改后的文本分镜'}),{home:e.home,reviewContent:async()=>({passed:true,failures:[]})})
 p=await e.store.read(e.id);shot=p.episodes[0].shots.items[0]
 assert.equal(shot.storyboard.content.prompt.text,'修改后的文本分镜');assert.equal(shot.storyboard.status,'passed')
 const raw=JSON.parse(await readFile(`${e.home}/storages/meiji/projects/${e.id}.json`,'utf8'))
 assert.equal(raw.schemaVersion,2);assert.equal('feedback' in raw.episodes[0],false);assert.equal('storyboard' in raw.episodes[0],false)
})
test('review drafts entered during generation survive success; submitted draft is cleared',()=>{
 const n=node('x','original');saveReview(n,'本次修改');begin(n,{id:'one'});saveReview(n,'下一次修改');finish(n,{passed:true,failures:[]})
 assert.equal(n.review.text,'下一次修改');begin(n,{id:'two'});finish(n,{passed:false,failures:['错误']});assert.equal(n.review.text,'下一次修改');begin(n,{id:'three'});finish(n,{passed:true,failures:[]});assert.equal(n.review.text,'')
})
test('one-time migration nests media and preserves text, feedback and IDs; runtime rejects old data',()=>{
 const old={id:'old',summary:'摘要',createdAt:'today',episodes:[{id:'e',customSkills:{seconds:'补充要求'},summary:'剧情',outline:'大纲',shots:{items:[{id:'S01',text:'镜头',duration:5,secondsText:'每秒'}]},storyboard:[{id:'S01',prompt:{text:'提示词'}}],boards:{S01:{url:'/pencil'}},films:{S01:{status:'ready',url:'/video'}},feedback:{'storyboard:S01':{check:{passed:false,failures:['方位']},review:{text:'保留动作',history:[]}}}}]}
 assert.throws(()=>assertDrama(old),/迁移/)
 const p=migrateProject(old),s=p.episodes[0].shots.items[0]
 assert.equal(p.episodes[0].customSkills,undefined);assert.match(p.skills.additions.seconds.generate,/第 1 集[\s\S]*补充要求/);assert.equal(s.content,'镜头');assert.equal(s.seconds.content,'每秒');assert.equal(s.pencil.content.url,'/pencil');assert.equal(s.video.status,'passed');assert.equal(s.storyboard.review.text,'保留动作');assert.deepEqual(migrateProject(p),p)
})
test('draft save does not invalidate an in-flight task, unrelated shot commits merge',async t=>{
 const e=await throughShots(t), scope={episodeId:e.episodeId,track:'S01'}, a=revisionStore(e.store,'a',scope),b=revisionStore(e.store,'b',{episodeId:e.episodeId,track:'S02'})
 const sa=scopeProjects(a,e.episodeId,'S01'),sb=scopeProjects(b,e.episodeId,'S02')
 const va=await sa.read(e.id),vb=await sb.read(e.id)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds:S01','新意见',0)
 va.shots.items[0].seconds=contentNode(va.shots.items[0].seconds,'甲',{passed:true,failures:[]})
 vb.shots.items[1].seconds=contentNode(vb.shots.items[1].seconds,'乙',{passed:true,failures:[]})
 await Promise.all([sa.save(e.id,{shots:va.shots}),sb.save(e.id,{shots:vb.shots})])
 const p=await e.store.read(e.id)
 assert.deepEqual(p.episodes[0].shots.items.map(s=>s.seconds.content),['甲','乙']);assert.equal(p.episodes[0].shots.items[0].seconds.review.text,'新意见')
})
test('reference report uses the exact ordered snapshot and detects missing references',()=>{
 const story={prompt:{text:'<Subject 2> 来自 <Picture 1>，持有 <Picture 3>。'},referenceSnapshot:[{id:'C1',url:'https://image/1',label:'人物'},{id:'E1',url:'https://image/2',label:'场景'}]}
 const report=referenceReport({},story)
 assert.deepEqual(report.missing,[3]);assert.equal(report.rows[0].subjects[0],'<Subject 2>');assert.equal(report.rows[1].used,false)
})
