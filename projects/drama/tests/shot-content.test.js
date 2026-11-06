import test from 'node:test'
import assert from 'node:assert/strict'
import {compileCandidate,candidateView} from '../src/node_box/shot_design/runtime/pipeline.js'
import {outputContract,parseCandidate} from '../src/node_box/shared/agent/contracts.js'
import {fixture} from './helpers/production-fixture.js'

const empty=()=>({characters:[],clothing:[],props:[],scenes:[],character_looks:[]})
const content=()=>({scene:'家中',characters:[{name:'武松',look:'家常',opening_state:'站在桌旁'}],props:[{name:'竹筐',holder:'郓哥',opening_state:'背负'}],beats:[{duration_seconds:8,action:'郓哥放下竹筐',camera:'中景',scene_changes:'',effects:'',dialogues:[{speaker:'郓哥',text:'武二哥！',delivery:{emotion:'喜悦',volume:'正常',pace:'自然',breath:'平稳'}}],soundscape:'街头人声',music:''}]})
const asset=(id,name)=>({id,name,description:'描述',image_ids:[],selected_image_id:null})
function project(){return {adaptation_plan:{data:{character_plans:[],scene_plans:[]}},story_segments:{segments:[{id:'segment',revision:1}]},asset_library:{
 characters:[{...asset('long_character_1','武松／林峥'),character_plan_id:null,voice_profile:{description:'低沉',revision:1,reference_audio_ref:null}},{...asset('correct_yunge_uuid','郓哥'),character_plan_id:null,voice_profile:{description:'清亮',revision:1,reference_audio_ref:null}}],
 clothing:[],props:[asset('basket','竹筐')],scenes:[{...asset('home','家中'),scene_plan_id:null,layout:'',entrances:'',landmarks:''}],character_looks:[{...asset('home_look','家常'),character_id:'long_character_1',clothing_ids:[],prop_ids:[],hair_and_makeup:'束发'}]},shot_design:{shots:[]},asset_requirements:{items:[]}}}

test('模型Schema没有ID字段，名称编译为正确人物、造型、持物者和对白引用',()=>{
 const p=project(),raw={assets:empty(),shots:[content()]},before=structuredClone(raw)
 parseCandidate('shot_design',{},raw)
 const compiled=compileCandidate({segment_id:'segment'},p,raw,{action:'generate'}),shot=compiled.shots[0]
 assert.equal(shot.characters[0].character_id,'long_character_1');assert.equal(shot.characters[0].look_id,'home_look')
 assert.equal(shot.props[0].holder_character_id,'correct_yunge_uuid');assert.equal(shot.beats[0].dialogues[0].speaker_id,'correct_yunge_uuid')
 assert.ok(shot.id);assert.ok(shot.beats[0].id);assert.ok(shot.beats[0].dialogues[0].id)
 assert.deepEqual(raw,before)
 const check=value=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){assert.ok(key!=='id'&&!/_(id|ids)$/.test(key),key);check(item)}}
 for(const action of ['generate','revise'])check(outputContract('shot_design',{},action))
 check(candidateView(p,compiled))
})

test('重做与局部修订保留稳定ID、图片和未修改镜头；审核名称视图无内部字段',()=>{
 const p=project(),raw={assets:empty(),shots:[content(),content()]},unit={segment_id:'segment'}
 const first=compileCandidate(unit,p,raw,{action:'generate'});p.shot_design.shots=structuredClone(first.shots)
 p.asset_library.characters[0].image_ids=['existing_image'];p.asset_library.characters[0].selected_image_id='existing_image'
 p.asset_library.characters[0].voice_profile.reference_audio_ref='artifacts/voice.wav'
 raw.assets.characters=[{name:'武松',description:'保留人物更新说明',voice_description:'沉稳'}]
 const second=compileCandidate(unit,p,raw,{action:'generate'})
 assert.deepEqual(second.shots.map(s=>s.id),first.shots.map(s=>s.id))
 assert.equal(second.assets.characters[0].id,'long_character_1')
 assert.deepEqual(second.assets.characters[0].image_ids,['existing_image'])
 assert.equal(second.assets.characters[0].selected_image_id,'existing_image')
 assert.equal(second.assets.characters[0].voice_profile.reference_audio_ref,'artifacts/voice.wav')
 const patch={assets:empty(),shot_updates:[{shot_number:2,shot:{...content(),beats:content().beats.map(b=>({...b,action:'修正动作'}))}}],shot_additions:[],shot_removals:[],shot_order:[]}
 const changed=compileCandidate(unit,p,patch,{action:'revise',candidate:first})
 assert.deepEqual(changed.shots[0],first.shots[0]);assert.equal(changed.shots[1].id,first.shots[1].id)
 assert.equal(changed.shots[1].beats[0].id,first.shots[1].beats[0].id)
 assert.equal(p.asset_library.characters[0].selected_image_id,'existing_image')
 assert.equal(candidateView(p,changed).shots[1].shot_number,2)
})

test('新人物、场景、服装、道具和造型由程序建档关联，素材需求程序派生',()=>{
 const p=project(),raw={assets:empty(),shots:[content()]}
 p.adaptation_plan.data.character_plans=[{id:'plan_wang',name:'王婆'}]
 raw.assets.characters=[{name:'王婆',description:'茶坊经营者',voice_description:'中年女声'}]
 raw.assets.clothing=[{name:'褐色外衣',description:'旧布外衣',group:''}]
 raw.assets.props=[{name:'茶壶',description:'粗陶茶壶'}]
 raw.assets.scenes=[{name:'茶坊后房',description:'后房',layout:'桌在中间',entrances:'门在左侧',landmarks:'木窗'}]
 raw.assets.character_looks=[{name:'王婆茶坊装',description:'穿褐色衣服持茶壶',character:'王婆',clothing:['褐色外衣'],props:['茶壶'],hair_and_makeup:'挽发'}]
 raw.shots[0].scene='茶坊后房';raw.shots[0].characters=[{name:'王婆',look:'王婆茶坊装',opening_state:'持茶壶'}]
 raw.shots[0].props=[{name:'茶壶',holder:'王婆',opening_state:'手持'}];raw.shots[0].beats[0].dialogues[0].speaker='王婆'
 const result=compileCandidate({segment_id:'segment'},p,raw,{action:'generate'})
 const character=result.assets.characters[0],look=result.assets.character_looks[0]
 assert.equal(character.character_plan_id,null);assert.ok(character.id)
 assert.equal(look.character_id,character.id)
 assert.deepEqual(look.clothing_ids,[result.assets.clothing[0].id]);assert.deepEqual(look.prop_ids,[result.assets.props[0].id])
 assert.equal(result.shots[0].props[0].holder_character_id,character.id)
 assert.deepEqual(result.requirements.map(r=>r.kind).sort(),['character_look','scene'])
 assert.equal(p.asset_library.characters.length,2)
})

test('名称版修订按冻结序号增删重排，序号错误不改动原候选',()=>{
 const p=project(),unit={segment_id:'segment'},base=compileCandidate(unit,p,{assets:empty(),shots:[content(),content()]},{action:'generate'})
 const before=structuredClone(base),change={assets:empty(),shot_updates:[],shot_additions:[content()],shot_removals:[{shot_number:1,reason:'内容已合并'}],shot_order:[3,2]}
 const result=compileCandidate(unit,p,change,{action:'revise',candidate:base})
 assert.equal(result.shots.length,2);assert.equal(result.shots[1].id,base.shots[1].id);assert.notEqual(result.shots[0].id,base.shots[0].id)
 assert.deepEqual(base,before)
 assert.throws(()=>compileCandidate(unit,p,{...change,shot_order:[4,2]},{action:'revise',candidate:base}),/序号不存在/)
 assert.throws(()=>compileCandidate(unit,p,{...change,shot_removals:[{shot_number:99,reason:'错误'}]},{action:'revise',candidate:base}),/序号不存在/)
})

test('同名歧义、未知名称、错误人物造型归属拒绝，不模糊匹配',()=>{
 const p=project(),raw={assets:empty(),shots:[content()]},run=()=>compileCandidate({segment_id:'segment'},p,raw,{action:'generate'})
 raw.shots[0].props[0].holder='郓鸽';assert.throws(run,/人物名称不存在/)
 raw.shots[0].props[0].holder='郓哥';p.asset_library.characters.push({...p.asset_library.characters[1],id:'other_yunge'});assert.throws(run,/名称有歧义/)
 p.asset_library.characters.pop();raw.shots[0].characters[0].name='郓哥';assert.throws(run,/不属于人物/)
})

test('真实制作链模型用名称，程序产生引用，素材生成绑定及视频提示词仍可执行',async t=>{
 const f=await fixture(t)
 for(const stage of ['source_analysis','adaptation_plan','story_segments','shot_design','asset_preparation','reference_binding','clip_arrangement','video_prompt'])await f.run(stage)
 const p=await f.project();assert.ok(p.shot_design.shots.every(s=>s.id&&s.characters[0].look_id&&s.beats[0].dialogues[0].speaker_id))
 const calls=f.calls.filter(c=>c.stage==='shot_design')
 for(const call of calls){
  const catalog=JSON.parse(call.messages[1].content),material=JSON.stringify(catalog.unit.material)
  assert.doesNotMatch(material,/character_id|look_id|speaker_id|image_ids|body_ref/)
  if(call.action==='review'){assert.ok(catalog.candidate.shots[0].shot_number);assert.equal(catalog.candidate.shots[0].id,undefined)}
 }
})
