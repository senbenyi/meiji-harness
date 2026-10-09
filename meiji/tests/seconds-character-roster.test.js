import test from 'node:test'
import assert from 'node:assert/strict'
import {episodeFixture,setupModel} from './fixtures/model.js'
import {cardModel} from '../server/models/data/drama-model.js'
import {secondsCharacterRoster,parseSecondsResponse,parseSecondsPartial,validateSeconds} from '../shared/seconds-content.js'
import {createLibraryEntry} from '../shared/library-rules.js'
import {buildSecondsPrompts} from '../server/prompts/shot-text-prompts.js'
import {checkSeconds} from '../server/flow/steps/step-review-seconds.js'
import {checkContext} from '../server/runtime/operation-context.js'
import {runOperation} from './fixtures/operation.js'
import {reviewPass} from './fixtures/review-result.js'
function named(p){const shot=p.shots.items[0],c=structuredClone(shot.seconds.content);c.version=2;c.participants=[{name:'旅人',presence:'visible',outfit:'灰色长衣，本镜着装不变'}];for(const b of c.beats)for(const field of ['action','camera','space','sound','endState'])b[field]=b[field].replace(/【([^|]+)\|[^】]+】/g,'$1');return {shot,c}}

test('每秒参与者只来自本集卡，模型误列项目独有角色由程序过滤，正文保留',()=>{
  const p=episodeFixture(),{shot,c}=named(p);p.library={characters:[],scenes:[],props:[]};createLibraryEntry(p,'characters',{name:'项目独有角色'})
  const parse=value=>parseSecondsResponse(JSON.stringify({shots:[value]}),[shot],p)
  assert.doesNotThrow(()=>parse(c))
  const outside={...c,participants:[{name:'项目独有角色',presence:'visible',outfit:'黑衣'}]},text=JSON.stringify({shots:[outside]})
  assert.deepEqual(parse(outside)[0].participants,[])
  const partial=parseSecondsPartial(text,[shot],p);assert.deepEqual(partial.sections,[{...outside,participants:[]}]);assert.deepEqual(partial.failures,{})
  assert.deepEqual(checkSeconds(text,p,{shotId:shot.id}),[])
  assert.doesNotThrow(()=>validateSeconds(outside,shot,p))
})

test('只接受本集卡明确关联的别名，不扩充库目录；卡名/sourceName均可用，双称谓重复和歧义拒绝',()=>{
  const p=episodeFixture(),{shot,c}=named(p);p.library={characters:[],scenes:[],props:[]}
  const {entry,variant}=createLibraryEntry(p,'characters',{name:'餐馆老板',aliases:['旅人','掌柜'],identity:'秘密身份不应入每秒请求',voiceDescription:'秘密声线'})
  Object.assign(p.plot.characters.items[0],{name:'餐馆老板',sourceName:'旅人',ref:{libraryId:entry.id,variantId:variant.id}})
  createLibraryEntry(p,'characters',{name:'别集人物',aliases:['未关联别名']})
  const before=structuredClone(p),roster=secondsCharacterRoster(p)
  assert.deepEqual(roster,[{name:'旅人',aliases:['餐馆老板','掌柜']}]);assert.deepEqual(p,before)
  for(const name of ['旅人','餐馆老板','掌柜'])assert.doesNotThrow(()=>parseSecondsResponse(JSON.stringify({shots:[{...c,participants:[{...c.participants[0],name}]}]}),[shot],p))
  assert.throws(()=>parseSecondsResponse(JSON.stringify({shots:[{...c,participants:[...c.participants,{...c.participants[0],name:'掌柜'}]}]}),[shot],p),/同一本集角色卡/)
  p.plot.characters.items.push(cardModel({id:'C02',name:'掌柜'}))
  assert.throws(()=>parseSecondsResponse(JSON.stringify({shots:[{...c,participants:[{...c.participants[0],name:'掌柜'}]}]}),[shot],p),/多张本集角色卡/)
})

test('空卡清单允许空参与者及独立旁白，voice也须来自本集，历史v1/v2读取不强加名单',()=>{
  const p=episodeFixture(),{shot,c}=named(p);p.plot.characters.items=[]
  const empty={...structuredClone(c),participants:[]};empty.dialogues=[{id:'D01',speakerName:'NARRATOR',text:'风吹过庭院。',language:'zh-CN',startMs:0,endMs:1000,delivery:'off',performance:'平静旁白'}];empty.beats[0].dialogueIds=['D01']
  const parse=value=>parseSecondsResponse(JSON.stringify({shots:[value]}),[shot],p)
  assert.doesNotThrow(()=>parse(empty));assert.deepEqual(parse(c)[0].participants,[])
  p.plot.characters.items=[cardModel({id:'C01',name:'旅人',presence:'voice'})]
  assert.doesNotThrow(()=>parse({...c,participants:[{name:'旅人',presence:'voice',outfit:''}]}))
  const legacy=episodeFixture();assert.doesNotThrow(()=>parseSecondsResponse(JSON.stringify({shots:[legacy.shots.items[0].seconds.content]}),[legacy.shots.items[0]],legacy))
  assert.doesNotThrow(()=>validateSeconds(c,shot,p));assert.doesNotThrow(()=>validateSeconds({...c,participants:undefined},shot,p))
})

test('生成修改审核共用本集称谓清单，不附固定外貌声线或库独有角色；无卡也明确给空目录',()=>{
  const p=episodeFixture();p.plot.characters.items[0].identity='固定身份秘密';p.plot.characters.items[0].voiceDescription='固定声线秘密';p.library={characters:[],scenes:[],props:[]};createLibraryEntry(p,'characters',{name:'项目独有角色'})
  for(const mode of ['regenerate','modify'])checkContext.run({generationMode:mode,originalProject:p},()=>{
    const prompts=buildSecondsPrompts({project:p,shotId:'S01'})
    for(const m of [prompts.generation,prompts.review('待审稿'),prompts.revision('基稿','修改')]){
      assert.match(m.user,/【本集角色卡人物清单：参与人物仅从中选取】/);assert.match(m.user,/"name":\s*"旅人"/)
      assert.doesNotMatch(m.user,/固定身份秘密|固定声线秘密|项目独有角色|"libraryId"/)
      const roster=JSON.parse(m.user.split('【本集角色卡人物清单：参与人物仅从中选取】\n')[1].split('\n\n')[0])
      assert.deepEqual(roster,[{name:'旅人',aliases:[]}])
      assert.match(m.system,/本集角色卡人物清单/)
    }
  })
  p.plot.characters.items=[];assert.match(buildSecondsPrompts({project:p,shotId:'S01'}).generation.user,/【本集角色卡人物清单：参与人物仅从中选取】\n\[\]/)
})

test('真实每秒任务保存仅卡内参与者和着装，人物卡与库不写回',async t=>{
  const e=await setupModel(t),p=await e.read(),{shot,c}=named(p),requests=[]
  await runOperation(e.op('shot-seconds',{track:shot.id}),{home:e.home,request:async m=>{requests.push(m);return m.skill==='review'?reviewPass:JSON.stringify({shots:[c]})}})
  const saved=await e.read();assert.equal(saved.shots.items[0].seconds.check.passed,true);assert.deepEqual(saved.shots.items[0].seconds.content.participants,c.participants)
  assert.deepEqual(saved.plot.characters.items,p.plot.characters.items);assert.deepEqual(saved.library,p.library)
  assert.ok(requests.every(m=>m.user.includes('【本集角色卡人物清单：参与人物仅从中选取】')))
})
