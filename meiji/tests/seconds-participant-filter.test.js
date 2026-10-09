import test from 'node:test'
import assert from 'node:assert/strict'
import {episodeFixture,setupModel} from './fixtures/model.js'
import {parseSecondsResponse,parseSecondsPartial,normalizeSecondsParticipants} from '../shared/seconds-content.js'
import {generateShotSeconds} from '../server/flow/tasks/text/task-shot-seconds.js'
import {runOperation} from './fixtures/operation.js'
import {reviewPass} from './fixtures/review-result.js'
import {setContent} from '../server/models/data/drama-model.js'
import {runStore,runRecordStore} from '../server/data/run-store.js'
function response(p){const shot=p.shots.items[0],c=structuredClone(shot.seconds.content);c.version=2;c.participants=[{name:'旅人',presence:'visible',outfit:'灰色长衣'},{name:'老板',presence:'voice',outfit:''}];for(const b of c.beats)for(const f of ['action','camera','space','sound','endState'])b[f]=b[f].replace(/【([^|]+)\|[^】]+】/g,'$1');c.beats[0].action='旅人询问，老板在后厨切菜并回答';c.beats[0].dialogueIds=['D02'];c.dialogues=[{id:'D02',speakerName:'老板',text:'咋，给你杀头猪？',language:'zh-CN',startMs:500,endMs:1500,delivery:'on',performance:'抬眼回话'}];return {shot,c,text:JSON.stringify({shots:[c]})}}
const approved=text=>JSON.stringify({passed:true,issues:[]})
test('新v2过滤误列卡外人物，正文/台词/声音/时长不改，原输入不变，卡内着装仍校验',()=>{
 const p=episodeFixture(),{shot,c,text}=response(p),before=structuredClone(c),clean=normalizeSecondsParticipants(c,p)
 assert.deepEqual(clean,{...c,participants:[c.participants[0]]});assert.deepEqual(c,before);assert.deepEqual(parseSecondsResponse(text,[shot],p),[clean]);assert.deepEqual(parseSecondsPartial(text,[shot],p),{sections:[clean],failures:{}})
 const bad={...c,participants:[{name:'旅人',presence:'visible'},c.participants[1]]};assert.match(parseSecondsPartial(JSON.stringify({shots:[bad]}),[shot],p).failures.S01,/outfit/)
 const malformed={...c,participants:[null]};assert.ok(parseSecondsPartial(JSON.stringify({shots:[malformed]}),[shot],p).failures.S01)
 const old={...c,version:1};assert.equal(normalizeSecondsParticipants(old,p),old)
})
test('直接生成+审核采用同一清理清单，不因卡外条目反复修订',async()=>{
 const p=episodeFixture(),{text}=response(p),calls=[]
 const result=await generateShotSeconds({project:p,shotId:'S01',request:async m=>{calls.push(m);if(m.skill==='review'){const body=m.user.split('【本次待审内容】\n')[1].split('\n\n')[0];const normalized=JSON.parse(body);assert.deepEqual(normalized.shots[0].participants.map(x=>x.name),['旅人']);return reviewPass}return text}})
 assert.equal(calls.length,2);assert.equal(result.items[0].seconds.check.passed,true);assert.deepEqual(result.items[0].seconds.content.participants.map(x=>x.name),['旅人'])
})
test('真实Run过滤后保存及自审，原始模型response仍留存，人物卡库不改',async t=>{
 const e=await setupModel(t),p=await e.read(),{shot,text,c}=response(p),requests=[]
 await runOperation(e.op('shot-seconds',{track:shot.id}),{home:e.home,request:async m=>{requests.push(m);return m.skill==='review'?reviewPass:text}})
 const saved=await e.read(),s=saved.shots.items[0];assert.equal(s.seconds.check.passed,true);assert.deepEqual(s.seconds.content.participants,[c.participants[0]]);assert.deepEqual(s.seconds.content.dialogues,c.dialogues);assert.deepEqual(saved.plot.characters.items,p.plot.characters.items);assert.deepEqual(saved.library,p.library)
 const run=(await runStore(e.home,e.id).list())[0],artifacts=await runRecordStore(e.home,e.id,run.id).list('artifacts');assert.ok(artifacts.some(a=>a.target==='seconds-response'&&a.content?.text===text))
 assert.equal(requests.filter(m=>m.skill==='review').length,1)
})
test('已有失败稿重新审核清理清单，更新revision并清理下游，不改动作或对白',async t=>{
 const e=await setupModel(t),p=await e.read(),{shot,c}=response(p)
 await e.store.save(e.id,root=>{const s=root.episodes[0].shots.items[0];setContent(s.seconds,c,{passed:false,failures:['旧卡外人物错误']});setContent(s.storyboard,{format:'text',prompt:{text:'旧提示词'}},{passed:true,failures:[]});return root})
 const before=await e.read(),requests=[]
 await runOperation(e.op('shot-seconds',{track:shot.id,mode:'review'}),{home:e.home,request:async m=>{requests.push(m);assert.equal(m.skill,'review');const body=JSON.parse(m.user.split('【本次待审内容】\n')[1].split('\n\n')[0]);assert.deepEqual(body.shots[0].participants.map(x=>x.name),['旅人']);return reviewPass}})
 const saved=await e.read(),s=saved.shots.items[0];assert.equal(s.seconds.check.passed,true);assert.ok(s.seconds.revision>before.shots.items[0].seconds.revision);assert.deepEqual(s.seconds.content,{...c,participants:[c.participants[0]]});assert.equal(s.storyboard.content,null);assert.deepEqual(saved.plot.characters.items,before.plot.characters.items);assert.deepEqual(saved.library,before.library);assert.equal(requests.length,1)
})
