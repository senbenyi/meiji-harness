import {makePlan} from './helpers/adaptation-plan.js'
import {stageProduct} from '../src/shared/production/production_stages.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createProjectDocument,assertProjectDocument,editProjectProduct,projectStages,projectDocumentSchema} from '../src/drama_runtime/drama_document.js'

const empty=()=>createProjectDocument({id:'p_001',name:'完整制作短剧'})
function populated(){
 const p=empty()
 p.source={current_revision_id:'src_001',revisions:[{id:'src_001',file_ref:'sources/src_001.txt',original_name:'原稿.txt',character_count:100}]}
 p.source_analysis={source_revision_id:'src_001',chapters:[{id:'chapter_001',sequence:1,title:'第一章',summary:'原著事实',body:'x'.repeat(100)}],coverage_ref:null}
 p.adaptation_plan=makePlan({revision:1,source_revision_id:'src_001',direction:'尊重原著，增强因果',requirements:['原话不变'],development:'保留原著主线，以人物动机增强冲突',character_plans:[{id:'cp_001',name:'张飞',description:'叙事人物',motivation:'迎战',relationships:'与对手对峙',arc:'成长'}],scene_plans:[{id:'sp_001',name:'战场',function:'对峙',description:'场景指导'}],group_plans:[]},['chapter_001'])
 p.story_segments={segments:[{id:'seg_001',sequence:1,revision:1,adaptation_revision:1,title:'对峙',body_ref:'story/seg_001.txt',continuity_ref:null}]}
 const asset=(id,name,image)=>({id,name,description:name,image_ids:[image],selected_image_id:image})
 p.asset_library={characters:[{...asset('char_001','张飞','img_face'),character_plan_id:'cp_001',voice_profile:{description:'低沉浑厚',reference_audio_ref:null,revision:1}}],clothing:[{...asset('clothing_001','战袍','img_clothing'),group_key:''}],props:[asset('prop_001','蛇矛','img_prop')],scenes:[{...asset('scene_001','战场','img_scene'),scene_plan_id:'sp_001',layout:'开阔',entrances:'东侧入口',landmarks:'大旗'}],character_looks:[{...asset('look_001','持矛造型','img_look'),character_id:'char_001',clothing_ids:['clothing_001'],prop_ids:['prop_001'],hair_and_makeup:'束发'}]}
 p.shot_design={shots:[{id:'shot_001',sequence:1,revision:1,story_segment_id:'seg_001',story_segment_revision:1,scene_id:'scene_001',characters:[{character_id:'char_001',look_id:'look_001',opening_state:'站立'}],props:[{prop_id:'prop_001',holder_character_id:'char_001',opening_state:'右手持矛'}],reference_images:[{image_id:'img_look',role:'人物定妆'},{image_id:'img_scene',role:'场景布局'}],beats:[{id:'beat_001',duration_seconds:5,action:'举矛',camera:'固定全景',scene_changes:'',effects:'',dialogues:[{id:'dialogue_001',speaker_id:'char_001',text:'来战！',delivery:{emotion:'愤怒',volume:'高',pace:'短促',breath:'有力'}}],soundscape:'风声',music:''}]}]}
 p.asset_requirements={items:[{id:'need_001',kind:'character_look',target_id:'look_001',shot_ids:['shot_001'],strategy:'reuse',status:'ready',image_id:'img_look'}]}
 p.clip_arrangement={clips:[{id:'clip_001',sequence:1,duration_seconds:5,sources:[{shot_id:'shot_001',beat_ids:['beat_001']}],mode:'reference',first_image_id:null,last_image_id:null}]}
 p.video_prompt={items:[{id:'prompt_001',clip_id:'clip_001',mode:'reference',revision:1,prompt_ref:'generation/prompt_001.txt',reference_images:[{image_id:'img_look',role:'人物定妆'}],voice_references:[]}]}
 p.videos=[{id:'take_001',clip_id:'clip_001',mode:'reference',prompt_id:'prompt_001',prompt_revision:1,file_ref:'media/take_001.mp4',duration_seconds:5,input_snapshot_ref:'artifacts/input.json',reference_image_ids:['img_look'],voice_references:[],status:'approved'}]
 p.editing={preview_ref:null,timelines:[{id:'timeline_001',name:'连续成片',revision:1,clips:[{id:'edit_001',take_id:'take_001',in_seconds:0,out_seconds:5,position_seconds:0}],transitions:[],subtitles_ref:null,audio_tracks_ref:null}]}
 p.episodes=[{id:'episode_001',title:'后期第一集',timeline_id:'timeline_001',start_seconds:0,end_seconds:5}]
 p.delivery={settings:p.delivery.settings,exports:[{id:'export_001',timeline_id:'timeline_001',episode_id:'episode_001',input_snapshot_ref:'artifacts/export-input.json',file_ref:'exports/episode_001.mp4',subtitles_ref:null,validation_report_ref:null}]}
 return assertProjectDocument(p)
}

test('V3空短剧不包含旧优化/重复资产/output包装，状态与业务产物分离',()=>{
 const p=empty();assert.equal(p.schema_version,4);assert.equal(p.episodes.length,0)
 for(const key of ['actual_script','summary','estimated_duration_seconds','script_revision_node','create_project_node'])assert.equal(Object.hasOwn(p.basic_info,key),false)
 for(const key of ['script_revision','character_extraction','scene_extraction','group_setting','legacy_archive_ref'])assert.equal(Object.hasOwn(p,key),false)
 assert.deepEqual(Object.keys(p.node_states),projectStages.map(row=>row.id))
 for(const stage of projectStages)assert.equal(Object.hasOwn(p[stage.field],'node_state'),false)
})

test('文档参考Schema和示例与真实契约一致，不能运行时读取文档作为模板',async()=>{
 assert.deepEqual(JSON.parse(await readFile(new URL('../docs/drama_v4.schema.json',import.meta.url),'utf8')),projectDocumentSchema)
 assertProjectDocument(JSON.parse(await readFile(new URL('../docs/drama_v4.example.json',import.meta.url),'utf8')))
})

test('所有阶段产物都可以通过同一人工编辑契约更新，保留意见/历史且不会冒充审核通过',()=>{
 for(const stage of projectStages){const p=populated();p.node_states[stage.id].opinion='人工意见'
 const value=stageProduct(p,stage.id)
 const next=editProjectProduct(p,stage.id,value,{expectedRevision:0})
 assert.equal(next.document_revision,1);assert.equal(next.node_states[stage.id].product_revision,1);assert.equal(next.node_states[stage.id].status,'draft');assert.equal(next.node_states[stage.id].opinion,'人工意见');assert.equal(Object.hasOwn(next.node_states[stage.id],'last_execution'),false);assert.equal(p.document_revision,0)
 }
})

test('人工编辑拒绝过期版本、直接修改状态、额外字段和非法阶段',()=>{
 const p=empty();assert.throws(()=>editProjectProduct(p,'adaptation_plan',p.adaptation_plan,{expectedRevision:1}),{code:'EDIT_CONFLICT'})
 assert.throws(()=>editProjectProduct(p,'node_states',{}, {expectedRevision:0}),/未知制作步骤/)
 assert.throws(()=>editProjectProduct(p,'source_analysis',{...p.source_analysis,status:'confirmed'},{expectedRevision:0}),/不允许字段/)
 assert.throws(()=>assertProjectDocument({...p,output:{}}),/不允许字段/)
})

test('人物/衣服/道具/造型的逻辑关系独立，选图及引用不能悬空',()=>{
 const p=populated();assert.equal(p.asset_library.character_looks[0].prop_ids[0],'prop_001')
 const bad=structuredClone(p);bad.asset_library.clothing=[];assert.throws(()=>assertProjectDocument(bad),/引用不存在/)
 const image=structuredClone(p);image.asset_library.characters[0].selected_image_id='img_other';assert.throws(()=>assertProjectDocument(image),/所选图片/)
 const holder=structuredClone(p);holder.shot_design.shots[0].props[0].holder_character_id='unknown';assert.throws(()=>assertProjectDocument(holder),/引用不存在/)
})

test('源版本、章节范围、计划及定稿引用完整校验',()=>{
 const p=populated();p.source_analysis.chapters[0].body+='x';assert.throws(()=>assertProjectDocument(p),/正文长度与原稿不一致/)
 const future=populated();future.story_segments.segments[0].adaptation_revision=2;assert.throws(()=>assertProjectDocument(future),/未来改编版本/)
 const duplicate=populated();duplicate.story_segments.segments.push({...duplicate.story_segments.segments[0]});assert.throws(()=>assertProjectDocument(duplicate),/ID重复/)
})

test('分镜修改和参考确认共用同一镜头产物，互相递增版本防止覆盖',()=>{
 const p=populated();const next=editProjectProduct(p,'reference_binding',p.shot_design,{expectedRevision:0})
 assert.equal(next.node_states.shot_design.product_revision,1);assert.equal(next.node_states.reference_binding.product_revision,1)
 assert.throws(()=>editProjectProduct(next,'shot_design',stageProduct(next,'shot_design'),{expectedRevision:0}),{code:'EDIT_CONFLICT'})
})

test('H3模式、分片时长和声音/图片输入边界可校验，固定声线与逐镜表演分开',()=>{
 const p=populated();p.clip_arrangement.clips[0].mode='first_frame';p.clip_arrangement.clips[0].first_image_id='img_first';p.video_prompt.items[0].mode='first_frame';assert.throws(()=>assertProjectDocument(p),/模式不支持参考/)
 const tooLong=populated();tooLong.clip_arrangement.clips[0].duration_seconds=16;assert.throws(()=>assertProjectDocument(tooLong),/不能超过15秒/)
 const wrongBeat=populated();wrongBeat.clip_arrangement.clips[0].sources[0].beat_ids=['missing'];assert.throws(()=>assertProjectDocument(wrongBeat),/节拍不属于/)
})

test('后期引用真实候选，裁切不可超实际时长，集界只归属时间线',()=>{
 const p=populated();p.editing.timelines[0].clips[0].out_seconds=6;assert.throws(()=>assertProjectDocument(p),/超出实际素材/)
 const episode=populated();episode.episodes[0].end_seconds=0;assert.throws(()=>assertProjectDocument(episode),/分集范围/)
 assert.equal(Object.hasOwn(populated().shot_design.shots[0],'episode_id'),false)
})

test('步骤按类型只保存实际需要的规则与检查点，退役字段不能写入',()=>{
 const p=populated()
 for(const stage of projectStages){
  const node=p.node_states[stage.id]
  assert.equal(Object.hasOwn(node,'rules'),stage.kind!=='program')
  assert.equal(Object.hasOwn(node,'checkpoint'),stage.kind==='ai')
  assert.equal(Object.hasOwn(node,'last_execution'),false)
  const old=structuredClone(p);old.node_states[stage.id].last_execution={task_id:'task',status:'failed',reason:'旧缓存'};assert.throws(()=>assertProjectDocument(old),/不允许字段/)
  if(stage.kind==='program'){const bad=structuredClone(p);bad.node_states[stage.id].rules={generate:'',review:'',revise:''};assert.throws(()=>assertProjectDocument(bad),/不允许字段/)}
  if(stage.kind!=='ai'){const bad=structuredClone(p);bad.node_states[stage.id].checkpoint=null;assert.throws(()=>assertProjectDocument(bad),/不允许字段/)}
 }
 for(const add of [d=>{d.source.revisions[0].line_index_ref=null},d=>{d.source_analysis.facts_ref=null},d=>{d.shot_design.shots[0].previous_shot_id=null},d=>{d.delivery.exports[0].settings_ref=null}]){
  const old=structuredClone(p);add(old);assert.throws(()=>assertProjectDocument(old),/不允许字段/)
 }
})

test('字段详解覆盖当前全部运行字段，注释不改变真实Schema',async()=>{
 const detail=JSON.parse(await readFile(new URL('../docs/drama_detail.json',import.meta.url),'utf8'))
 function expand(value,seen=new Set()){
  if(Array.isArray(value))return value.map(item=>expand(item,seen))
  if(!value||typeof value!=='object')return value
  if(value.$ref){
   const ref=value.$ref;assert.match(ref,/^#\/\$defs\/[A-Za-z][A-Za-z0-9]*$/);assert.ok(!seen.has(ref),'文档引用不能循环：'+ref)
   const target=detail.$defs?.[ref.slice('#/$defs/'.length)];assert.ok(target,'文档引用不存在：'+ref)
   const {$ref,...annotations}=value;return expand({...target,...annotations},new Set([...seen,ref]))
  }
  return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$defs').map(([key,item])=>[key,expand(item,seen)]))
 }
 function strip(value){if(Array.isArray(value))return value.map(strip);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).filter(([key,value])=>!(typeof value==='string'&&['description','$comment'].includes(key))).map(([key,value])=>[key,strip(value)]))}
 function check(value){for(const schema of Object.values(value.properties||{}))assert.ok(schema.description);for(const item of Object.values(value))if(Array.isArray(item))item.filter(v=>v&&typeof v==='object').forEach(check);else if(item&&typeof item==='object')check(item)}
 const expanded=expand(detail)
 check(expanded);assert.deepEqual(strip(expanded),strip(projectDocumentSchema));assert.equal(detail.properties.adaptation_plan.properties.creative_constraints.description,projectDocumentSchema.properties.adaptation_plan.properties.creative_constraints.description)
 assert.equal(Object.hasOwn(detail.properties.source_analysis.properties,'facts_ref'),false)
 assert.match(detail.properties.adaptation_plan.properties.group_plans.items.properties.social_role.description,/团队身份/)
 assert.equal(detail.properties.basic_info.properties.id.description,'稳定唯一标识')
 for(const key of ['group_setting','character_extraction','scene_extraction','change_plans'])assert.equal(Object.hasOwn(detail.properties,key),false)
})

test('精简团队指导可空，ID不能重复，旧字段与旧定稿关联必须拒绝',()=>{
 const p=populated(),group={id:'g_001',name:'守卫队',social_role:'营地守卫',description:'保持共同组织形象，成员面容各异'}
 p.adaptation_plan.group_plans=[group];assertProjectDocument(p)
 const duplicate=structuredClone(p);duplicate.adaptation_plan.group_plans.push(group);assert.throws(()=>assertProjectDocument(duplicate),/ID重复/)
 for(const field of ['segment_plans','plot_plan_ref']){const bad=populated();bad.adaptation_plan[field]=field==='segment_plans'?[]:null;assert.throws(()=>assertProjectDocument(bad),/不允许字段/)}
 for(const field of ['costumes','era','region','appearance','demeanor','visual_identity','immutable_traits']){const bad=structuredClone(p);bad.adaptation_plan.group_plans[0][field]='旧值';assert.throws(()=>assertProjectDocument(bad),/不允许字段/)}
 for(const field of ['voice_description','source_character_refs']){const bad=populated();bad.adaptation_plan.character_plans[0][field]='旧值';assert.throws(()=>assertProjectDocument(bad),/不允许字段/)}
 for(const field of ['plan_item_id','plan_revision']){const bad=populated();bad.story_segments.segments[0][field]='旧值';assert.throws(()=>assertProjectDocument(bad),/不允许字段/)}
 for(const field of ['source_chapter_ids','source_spans']){const source=populated();source.story_segments.segments[0][field]=[];assert.throws(()=>assertProjectDocument(source),/不允许字段/)}
 assert.deepEqual(empty().adaptation_plan.group_plans,[])
})
