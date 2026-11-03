import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {ProjectWorkspaceService} from '../../src/drama_runtime/drama_workspace_service.js'
import {createRecordService} from '../../src/records/service.js'
import {createModelSettings} from '../../src/settings/model-settings.js'
import {ProductionService} from '../../src/node_box/shared/production/service.js'
import {createProjectHttpHandler} from '../../src/harness_server/project_routes.js'
import {command,probeBytes} from '../../src/shared/media/media.js'
import {sourceChapters,sourcePages,assertCoverage} from '../../src/shared/text/source.js'
import {arrangeClips} from '../../src/node_box/clip_arrangement/runtime/pipeline.js'
export const call=(name,args={})=>({id:'call_'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}})
export const reply=calls=>({role:'assistant',content:null,tool_calls:calls})
export async function fixture(t,{script='第一章 营帐\n张飞走进营帐。\n第二章 对峙\n张飞说：“来战！”',author,previewHtml}={}){
 const root=await mkdtemp(join(tmpdir(),'drama-complete-')),records=createRecordService(root)
 let service,projects,production,origin;const calls=[],requests=[]
 const image=join(root,'fixture.png'),video=join(root,'fixture.mp4')
 await command('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x64','-frames:v','1','-y',image])
 await command('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=10','-f','lavfi','-i','sine=frequency=240:sample_rate=48000','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',video])
 const png=await readFile(image),mp4=await readFile(video)
 const server=createServer(async(req,res)=>{try{
   if(req.url==='/video.mp4'){res.writeHead(200,{'content-type':'video/mp4'});return res.end(mp4)}
   req.url=req.url.replace(/^\/v1/,'')
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push({path:req.url,body});res.setHeader('content-type','application/json')
   if(req.url==='/chat/completions'){
     const message=await (author||defaultAuthor)(body,{projects,production,calls});return res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message}]}))
   }
   if(req.url==='/images/generations')return res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}))
   if(req.url==='/videos/generations')return res.end(JSON.stringify({status:'succeeded',task_id:'remote_'+randomUUID(),url:origin+'/video.mp4'}))
   res.writeHead(404);res.end('{}')
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:{message:error.stack}}))}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`
 const models=createModelSettings(root,{baseUrl:origin+'/v1'})
 projects=new ProjectWorkspaceService({root,records,workspaceController:{create:async()=>({workspace:{workspaceId:randomUUID()}}),rename:async()=>{}},sessionController:{create:async({sessionId})=>({sessionId})}})
 production=new ProductionService({projects,models});const created=await projects.create({name:'全流程测试',original_script:script},{sessionId:'source',requestId:'create'})
 const context={sessionId:created.session_id,projectId:created.project_id},handler=createProjectHttpHandler(projects,{authorize:()=>null,models}),api=createServer((req,res)=>{if(previewHtml&&req.url.startsWith('/preview')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(previewHtml)}return handler(req,res)});await new Promise(r=>api.listen(0,'127.0.0.1',r))
 t.after(async()=>{await projects.dispose();await handler.dispose();await new Promise(r=>api.close(r));await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})})
 const project=()=>projects.documents.read(created.project_id)
 const run=async(stage,input={})=>{const started=await production.run(stage,input,{...context,requestId:randomUUID()}),detail=await production.wait(started.group_id);assert.equal(detail.status,'completed',`${stage}: ${detail.reason}`);return detail}
 const edit=async command=>projects.edit(command,{...context,requestId:randomUUID()})
 return {root,projects,production,models,created,context,project,run,edit,calls,requests,png,mp4,api:`http://127.0.0.1:${api.address().port}/api/drama`}
}
export async function defaultAuthor(body,{projects,calls}){
 const catalog=JSON.parse(body.messages[1].content),{stage,action,unit}=catalog;calls.push({stage,action,unit:unit.id,messages:body.messages})
 const previous=body.messages.flatMap(m=>m.tool_calls||[])
 if(!previous.some(c=>['read_source','read_file','read_candidate','read_unit'].includes(c.function.name))){
   const reads=catalog.unit_material_included?[]:[call('read_unit')]
   for(const range of unit.source_spans||[])for(let start=range.start;start<range.end;start+=16000)reads.push(call('read_source',{start,end:Math.min(start+16000,range.end)}))
   for(const ref of unit.read_refs||[])reads.push(call('read_file',{ref,start:0,end:16000}))
   if(action!=='generate')for(let start=0;start<catalog.candidate_characters;start+=16000)reads.push(call('read_candidate',{start,end:Math.min(start+16000,catalog.candidate_characters)}))
   if(reads.length)return reply(reads)
 }
 const missed=body.messages.filter(m=>m.role==='tool'&&JSON.parse(m.content).error?.includes('读取预算')).map(m=>previous.find(c=>c.id===m.tool_call_id)).filter(c=>!body.messages.some(m=>m.role==='tool'&&previous.find(x=>x.id===m.tool_call_id)?.function.arguments===c.function.arguments&&previous.find(x=>x.id===m.tool_call_id)?.function.name===c.function.name&&!JSON.parse(m.content).error));if(missed.length)return reply(missed.map(c=>call(c.function.name,JSON.parse(c.function.arguments))))
 if(action==='review')return reply([call('submit_review',{output:{status:'passed',issues:[],suggestions:[]}})])
 const snapshot=JSON.parse((await projects.documents.readArtifact(catalog.project_id,catalog.materials.snapshot_ref)).toString()),p=snapshot
 let output
 if(stage==='adaptation_plan')output={goal:'风格：保持原著气质并强化戏剧张力；受众：未指定，待确认；改编尺度：保留主线，适度强化因果；保留：人物关系和关键对白；允许调整：重复表达与动作呈现',locked_requirements:['保留对白原文'],plot_text:'保留原著主线，以人物动机强化营帐对峙的张力；具体分段和衔接由定稿完成。',character_plans:[{id:'cp_zhang',name:'张飞',description:'魁梧勇猛',motivation:'直面对手',relationships:'与对手形成对峙',arc:'由进帐到主动迎战'}],scene_plans:[{id:'sp_tent',name:'营帐',function:'对峙',description:'营帐内部'}],group_plans:[]}
 if(stage==='story_segments'){
  const existing=p.story_segments.segments.filter(s=>unit.kind==='story_audit'?unit.segment_ids.includes(s.id):unit.source_chapter_ids.length?s.source_chapter_ids.some(id=>unit.source_chapter_ids.includes(id)):!s.source_chapter_ids.length)
  const count=unit.kind==='story_audit'?existing.length:p.source_analysis.chapters.find(c=>unit.source_chapter_ids.includes(c.id))?.body.includes('第二章')?2:1
  output={segments:Array.from({length:count},(_,i)=>({id:existing[i]?.id||`seg_${unit.source_chapter_ids[0]||'free'}_${i+1}`,title:i?'后续对峙':'营帐对峙',body:'张飞走进营帐，直视对方，说：“来战！”',continuity:'开场走入营帐；结尾站在帐中直视对手。'}))}
 }
 if(stage==='shot_design'){
  const character=p.asset_library.characters.find(c=>c.character_plan_id==='cp_zhang'),scene=p.asset_library.scenes.find(s=>s.scene_plan_id==='sp_tent'),segment=p.story_segments.segments.find(s=>s.id===unit.segment_id),shotId='shot_'+segment.id
  output={assets:{characters:[{...character,voice_profile:{...character.voice_profile,description:'低沉浑厚的成熟男声'}}],clothing:[{id:'clothing_robe',name:'战袍',description:'深色战袍',group_key:'',image_ids:[],selected_image_id:null}],props:[],scenes:[],character_looks:[{id:'look_zhang',name:'张飞战袍定妆',description:'张飞穿深色战袍',image_ids:[],selected_image_id:null,character_id:character.id,clothing_ids:['clothing_robe'],prop_ids:[],hair_and_makeup:'束发'}]},shots:[{id:shotId,sequence:segment.sequence,revision:1,story_segment_id:segment.id,story_segment_revision:segment.revision,previous_shot_id:p.shot_design.shots.at(-1)?.id||null,scene_id:scene.id,characters:[{character_id:character.id,look_id:'look_zhang',opening_state:'帐中站立'}],props:[],reference_images:[],beats:[{id:'beat_'+shotId,duration_seconds:4,action:'张飞直视对方',camera:'固定中景',scene_changes:'',effects:'',dialogues:[{id:'line_'+shotId,speaker_id:character.id,text:'来战！',delivery:{emotion:'愤怒',volume:'高',pace:'短促',breath:'有力'}}],soundscape:'营帐内轻微风声',music:''}]}],requirements:[]}
 }
 if(stage==='video_prompt'){
  const clip=p.clip_arrangement.clips.find(c=>c.id===unit.clip_id),shots=clip.sources.map(s=>p.shot_design.shots.find(shot=>shot.id===s.shot_id)),character=p.asset_library.characters[0]
  output={prompt:'参考Image1中的人物定妆，保持Image2场景布局。张飞以低沉浑厚的愤怒男声说：“来战！”固定中景。',reference_images:[...new Set(shots.flatMap(s=>s.reference_images.map(r=>r.image_id)))].map((id,i)=>({image_id:id,role:'Image'+(i+1)})),voice_references:character.voice_profile.reference_audio_ref?[{character_id:character.id,voice_revision:character.voice_profile.revision,audio_ref:character.voice_profile.reference_audio_ref}]:[]}
 }
 return reply([call('submit_candidate',{output})])
}
