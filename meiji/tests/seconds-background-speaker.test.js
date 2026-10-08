import test from 'node:test'
import assert from 'node:assert/strict'
import {episodeFixture,setupModel} from './fixtures/model.js'
import {runOperation} from './fixtures/operation.js'
import {reviewPass} from './fixtures/review-result.js'
import {createLibraryEntry,applyLibraryCard} from '../shared/library-rules.js'
import {parseSecondsPartial,parseSecondsResponse,validateSeconds} from '../shared/seconds-content.js'
import {compileVideoPrompt} from '../server/prompts/video-prompt-renderer.js'
import {reviewStep} from '../server/flow/steps/shared/text-review.js'
import {checkContext} from '../server/runtime/operation-context.js'
import {buildSecondsPrompts} from '../server/prompts/shot-text-prompts.js'
function content(p){const shot=p.shots.items[0],c=structuredClone(shot.seconds.content);c.version=2;c.participants=[{name:'旅人',presence:'visible',outfit:'灰色长衣'}];for(const b of c.beats)for(const field of ['action','camera','space','sound','endState'])b[field]=b[field].replace(/【([^|]+)\|[^】]+】/g,'$1');c.beats[0].action='旅人询问，后厨老板继续切菜并回答';c.beats[0].dialogueIds=['D01','D02'];c.dialogues=[{id:'D01',speakerName:'旅人',text:'老板，菜怎么这么少？',language:'zh-CN',startMs:0,endMs:1500,delivery:'on',performance:'抱怨，开口'},{id:'D02',speakerName:'老板',text:'咋，给你杀头猪？',language:'zh-CN',startMs:2000,endMs:4000,delivery:'on',performance:'抬眼回答，嘴部同步'}];return {shot,c}}
test('卡外老板对白保留，名单只列卡内；不改台词、不建卡、不引入未关联库图',()=>{
 for(const delivery of ['on','off','inner'])for(const image of [null,{assetId:'traveler-image',localPath:'/traveler.png'}]){
  const p=episodeFixture(),{shot,c}=content(p);c.dialogues[1].delivery=delivery;p.library={characters:[],scenes:[],props:[]};createLibraryEntry(p,'characters',{name:'老板',voiceDescription:'未关联声线',image:{content:{localPath:'/boss.png',assetId:'boss'}}});p.plot.characters.items[0].image.content=image;shot.seconds.content=c
  const before=structuredClone(p);assert.doesNotThrow(()=>parseSecondsResponse(JSON.stringify({shots:[c]}),[shot],p));const out=compileVideoPrompt(p,shot)
  assert.ok(out.prompt.text.includes('咋，给你杀头猪？'));assert.match(out.prompt.text,new RegExp('老板 \\(S2\\).*'+{on:'画内',off:'画外',inner:'内心独白'}[delivery]));assert.ok(out.prompt.text.includes('后厨老板'));assert.deepEqual(out.outfitSnapshot,[{name:'旅人',outfit:'灰色长衣'}]);assert.ok(out.referenceSnapshot.every(x=>x.assetId!=='boss'));assert.doesNotMatch(out.prompt.text,/未关联声线/);assert.deepEqual(p,before)
 }
})
test('卡内遗漏及画内类型错误仍拒绝，误列卡外清单会过滤，不伪造旁白',()=>{
 const p=episodeFixture(),{shot,c}=content(p),parse=c=>parseSecondsPartial(JSON.stringify({shots:[c]}),[shot],p).failures.S01
 assert.match(parse({...c,participants:[]}),/D01.*旅人.*本集角色卡.*必须列入participants/);assert.match(parse({...c,participants:[{name:'旅人',presence:'voice',outfit:''}]}),/D01.*出镜类型不一致.*旅人.*delivery=on.*visible/);assert.equal(parse({...c,participants:[...c.participants,{name:'老板',presence:'visible',outfit:'围裙'}]}),undefined)
 assert.throws(()=>validateSeconds({...c,dialogues:[{...c.dialogues[0],speakerName:'NARRATOR'},c.dialogues[1]]},shot,p),/对白身份/)
})
test('卡名与登记别名是同一对白身份，原称谓不改，稳定声音和S编号一致',()=>{
 const p=episodeFixture(),{shot,c}=content(p);p.library={characters:[],scenes:[],props:[]};const {entry,variant}=createLibraryEntry(p,'characters',{...p.plot.characters.items[0],name:'餐馆老板',aliases:['旅人','掌柜'],voiceDescription:'低沉固定声线'});p.plot.characters.items[0]=applyLibraryCard(p,'characters',p.plot.characters.items[0],{entry,variant});p.plot.characters.items[0].sourceName='旅人';c.dialogues[1].speakerName='掌柜';shot.seconds.content=c
 assert.doesNotThrow(()=>parseSecondsResponse(JSON.stringify({shots:[c]}),[shot],p));const before=structuredClone(p),out=compileVideoPrompt(p,shot);assert.match(out.prompt.text,/低沉固定声线/);assert.doesNotMatch(out.prompt.text,/\(S2\)/);assert.deepEqual(p,before)
})
test('审核合并同一问题只留一次，不同修正要求保留，保存结果一致',async()=>{
 const issue={location:'程序校验',reason:'S01/D02 出镜类型不一致',requirement:'按该校验要求修正正文'},other={...issue,requirement:'核对说话人'},saved=[]
 const result=await checkContext.run({},()=>reviewStep({text:'稿',message:{skill:'review'},check:()=>[issue.reason,issue.reason],options:{request:async()=>JSON.stringify({passed:false,issues:[issue,issue,other]})},persist:x=>saved.push(x)}));assert.deepEqual(result.review.issues,[issue,other]);assert.equal(result.check.failures.length,2);assert.deepEqual(saved[0],result)
})
test('真实每秒生成保存老板对白，不添加卡或参与者，之后直接编排',async t=>{
 const e=await setupModel(t),p=await e.read(),{shot,c}=content(p);await runOperation(e.op('shot-seconds',{track:shot.id}),{home:e.home,request:async m=>m.skill==='review'?reviewPass:JSON.stringify({shots:[c]})});const saved=await e.read(),s=saved.shots.items[0];assert.equal(s.seconds.check.passed,true);assert.deepEqual(s.seconds.content.participants,c.participants);assert.deepEqual(s.seconds.content.dialogues,c.dialogues);assert.deepEqual(saved.plot.characters.items,p.plot.characters.items);assert.deepEqual(saved.library,p.library);assert.doesNotThrow(()=>compileVideoPrompt(saved,s))
})
test('生成修改审核规则明确卡外剧情人物保留动作对白，不冒充旁白或要求建卡',()=>{
 const p=episodeFixture(),prompts=buildSecondsPrompts({project:p,shotId:'S01'});for(const m of [prompts.generation,prompts.revision('基稿','修改'),prompts.review('待审稿')]){assert.match(m.system,/卡外剧情人物/);assert.match(m.system,/不.*NARRATOR/s);assert.match(m.system,/卡内说话人/)}
})
