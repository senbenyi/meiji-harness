import {projectNodeStates} from '../src/shared/production/production_stages.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {command,probeBytes} from '../src/shared/media/media.js'
import {sourceChapters,sourcePages,assertCoverage,assertSourceText,chapterRanges,readChapterText} from '../src/shared/text/source.js'
import {subtitleText} from '../src/node_box/editing/runtime/pipeline.js'
import {parseSubtitles} from '../src/node_box/shared/media/subtitles.js'
import {fixture,defaultAuthor,call,reply} from './helpers/production-fixture.js'

test('从创建到所有制作阶段：真实模拟网关、独立审核、共享图片、声音、ffmpeg剪辑与最终导出',async t=>{
 const f=await fixture(t);await f.run('source_analysis');let p=await f.project();assert.equal(p.source_analysis.chapters.length,1);assert.equal(p.source_analysis.coverage_ref,null);assert.equal(f.requests.length,0)
 await f.run('adaptation_plan');p=await f.project();assert.ok(p.adaptation_plan.data.story_direction.main_plot);assert.equal(Object.hasOwn(p.adaptation_plan,'segment_plans'),false);assert.equal(p.episodes.length,0);assert.equal(p.asset_library.characters.length,1)
 await f.run('story_segments');assert.ok(f.calls.filter(c=>c.stage==='story_segments'&&c.action==='generate').some(c=>c.messages.some(m=>m.tool_calls?.some(call=>call.function.name==='read_source'))),'定稿必须实际读取原剧本');await f.run('shot_design');p=await f.project();assert.equal(p.shot_design.shots.length,2)
 await f.run('asset_preparation');p=await f.project();assert.equal(projectNodeStates(p).asset_preparation.status,'confirmed');assert.equal(p.asset_library.scenes[0].selected_image_id,null);assert.equal(f.production.images.list().total,2)
 for(const key of ['scenes','character_looks'])for(const asset of p.asset_library[key])await f.edit({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:asset.image_ids[0]})
 p=await f.project();await f.run('asset_preparation',{target_id:p.asset_library.clothing[0].id});p=await f.project();await f.edit({kind:'image_select',stage:'asset_preparation',target_id:p.asset_library.clothing[0].id,image_id:p.asset_library.clothing[0].image_ids[0]});await f.run('asset_preparation',{target_id:p.asset_library.character_looks[0].id,regenerate:true});p=await f.project();await f.edit({kind:'image_select',stage:'asset_preparation',target_id:p.asset_library.character_looks[0].id,image_id:p.asset_library.character_looks[0].image_ids.at(-1)});assert.ok(f.requests.some(r=>r.path==='/images/generations'&&r.body.images?.length===1),'独立服装图应进入组合定妆的真实模型输入')
 const voice=join(f.root,'voice.wav');await command('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=240:sample_rate=48000','-t','2','-y',voice]);p=await f.project();await f.edit({kind:'audio_import',stage:'asset_preparation',character_id:p.asset_library.characters[0].id,base64:(await readFile(voice)).toString('base64'),confirmed_clean:true})
 p=await f.project();await f.edit({kind:'confirm_stage',stage:'asset_preparation',expected_revision:projectNodeStates(p).asset_preparation.product_revision})
 await f.run('reference_binding');await f.run('clip_arrangement');await f.run('video_prompt');await f.run('video_render');p=await f.project();assert.equal(p.videos.length,2);assert.equal(projectNodeStates(p).video_render.status,'draft');assert.ok(f.requests.filter(r=>r.path==='/videos/generations').every(r=>r.body.audios.length===1))
 for(const take of p.videos)await f.edit({kind:'video_select',stage:'video_render',take_id:take.id});p=await f.project();await f.edit({kind:'confirm_stage',stage:'video_render',expected_revision:projectNodeStates(p).video_render.product_revision})
 await f.edit({kind:'product',stage:'delivery',expected_revision:0,value:{episodes:[],delivery:{...p.delivery,settings:{width:64,height:64,fps:10,subtitle_mode:'sidecar',normalize_audio:true}}}})
 await f.run('editing');p=await f.project();assert.ok(p.editing.preview_ref);assert.equal(p.editing.timelines[0].clips.length,2)
 await f.run('delivery',{episode_seconds:4});p=await f.project();assert.equal(p.episodes.length,2);assert.equal(p.delivery.exports.length,2)
 for(const item of p.delivery.exports){const bytes=await f.projects.documents.readArtifact(p.basic_info.id,item.file_ref);assert.ok((await probeBytes(bytes,'mp4')).video);assert.equal(Object.hasOwn(item,'settings_ref'),false);const frozen=JSON.parse((await f.projects.documents.readArtifact(p.basic_info.id,item.input_snapshot_ref)).toString());assert.deepEqual(frozen.settings,p.delivery.settings)}
 assert.equal(projectNodeStates(p).delivery.status,'confirmed');assert.ok(f.calls.filter(c=>c.action==='review').every(c=>!c.messages.some(m=>(m.tool_calls||[]).some(call=>call.function.name==='submit_candidate'))))
 const tables=f.production.images.database.prepare('PRAGMA table_info(images)').all();assert.deepEqual(tables.map(c=>c.name),['id','url'])
 const media=await fetch(`${f.api}/production-file?session_id=${f.context.sessionId}&ref=${p.delivery.exports[0].file_ref}`,{headers:{range:'bytes=0-31'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,32)
 assert.ok(f.requests.some(r=>r.path==='/chat/completions'));assert.ok(f.projects.records.http.list().length>0)
 // Old video subtitles retain the exact dialogue that was generated, even after current shots change.
 const changed=structuredClone(p);changed.shot_design.shots[0].beats[0].dialogues[0].text='后改对白';assert.ok(!(await subtitleText(f.production,changed,p.editing.timelines[0])).includes('后改对白'))
 for(const item of p.delivery.exports){const text=(await f.projects.documents.readArtifact(p.basic_info.id,item.subtitles_ref)).toString();assert.equal(parseSubtitles(text)[0].start,0)}
 await f.edit({kind:'product',stage:'delivery',expected_revision:projectNodeStates(p).delivery.product_revision,value:{episodes:[],delivery:p.delivery}});p=await f.project()
 const editing=structuredClone(p.editing),timeline=editing.timelines[0];timeline.clips[0].in_seconds=.5;timeline.clips[0].out_seconds=3.5;timeline.clips[1].position_seconds=3;timeline.transitions=[{clip_id:timeline.clips[0].id,duration_seconds:.3}];timeline.revision++
 await f.edit({kind:'product',stage:'editing',expected_revision:projectNodeStates(p).editing.product_revision,value:editing})
 await f.edit({kind:'regenerate_subtitles',stage:'editing',timeline_id:timeline.id});await f.edit({kind:'audio_import',stage:'editing',role:'track',timeline_id:timeline.id,base64:(await readFile(voice)).toString('base64')})
 p=await f.project();await f.edit({kind:'product',stage:'delivery',expected_revision:projectNodeStates(p).delivery.product_revision,value:{episodes:[],delivery:{...p.delivery,settings:{...p.delivery.settings,width:128,height:128,subtitle_mode:'burn'}}}})
 await f.run('editing',{use_existing:true});await f.run('delivery',{episode_seconds:4});p=await f.project();const burned=p.delivery.exports.at(-1),report=JSON.parse((await f.projects.documents.readArtifact(p.basic_info.id,burned.validation_report_ref)).toString());assert.equal(report.subtitle_renderer,'canvas-png-overlay');assert.ok(report.subtitle_count>0);assert.equal(report.width,128)
 const burnedFile=join(f.root,'burned.mp4'),frame=join(f.root,'frame.rgb');await writeFile(burnedFile,await f.projects.documents.readArtifact(p.basic_info.id,burned.file_ref));await command('ffmpeg',['-v','error','-ss','1','-i',burnedFile,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-y',frame]);const pixels=await readFile(frame);let whites=0;for(let i=0;i<pixels.length;i+=3)if(pixels[i]>180&&pixels[i+1]>180&&pixels[i+2]>180)whites++;assert.ok(whites>5,'真实导出帧应含白色文字，不只是生成字幕元数据')

})

test('章节与长页覆盖不拆坏原章或UTF16，超长行仍有界',()=>{
 const text='第一章 大章\n'+'张飞😀'.repeat(12000)+'\n第二章 尾声\n结束',chapters=sourceChapters(text,[],'src_1'),pages=sourcePages(text,chapters);assert.ok(chapters.length>3);assert.equal(chapters.map(c=>c.body).join(''),text);assert.ok(chapters.every(c=>!Object.hasOwn(c,'source_spans')&&c.body.length<=12000));assert.ok(pages.length>3);assertCoverage(text.length,pages);for(const page of pages){assert.ok(page.end-page.start<=12000);assert.ok(!/[\uD800-\uDBFF]$/.test(text.slice(page.start,page.end)))}
})

test('原著解析纯程序保存整稿，多章节也不拆分，零模型请求且重复执行ID稳定',async t=>{
 const text='第一章\r\n'+'完整原文😀。'.repeat(4000)+'\n第二章\n结尾',f=await fixture(t,{script:text,author:async()=>{throw Error('must not call model')}})
 f.production.memoryMaintenance.ensure=async()=>{throw Error('must not run memory model')}
 const first=await f.run('source_analysis'),p=await f.project();assert.deepEqual(first.steps.map(s=>s.kind),['prepare','execute','finish']);assert.equal(p.source_analysis.chapters.length,1);assert.equal(p.source_analysis.chapters[0].body,text);assert.equal(p.source_analysis.chapters[0].summary,'');assert.equal(Object.hasOwn(p.source_analysis,'facts_ref'),false);assert.equal(p.source_analysis.coverage_ref,null);assert.equal(f.requests.length,0)
 await f.run('source_analysis');const next=await f.project();assert.equal(next.source_analysis.chapters[0].id,p.source_analysis.chapters[0].id);assert.equal(projectNodeStates(next).source_analysis.status,'confirmed');assert.equal(f.requests.length,0)
})

test('缺原稿的剧本模式如实失败，自由创作可保持空原著产物',async t=>{
 const f=await fixture(t,{script:''}),started=await f.production.run('source_analysis',{}, {...f.context,requestId:'no-source'}),detail=await f.production.wait(started.group_id);assert.equal(detail.status,'failed');assert.match(detail.reason,/导入原稿/);assert.equal(f.requests.length,0)
 await f.projects.documents.mutate(f.context.projectId,p=>{p.basic_info.creation_mode='自由创作';return p});await f.run('source_analysis');assert.equal((await f.project()).source_analysis.chapters.length,0);assert.equal(f.requests.length,0)
})

test('无效审核证据不能驱动修订，联合规划仍保留最新候选和失败记录',async t=>{
 const f=await fixture(t,{author:async(body,ctx)=>{const c=JSON.parse(body.messages[1].content);if(c.action==='review'&&body.messages.some(m=>(m.tool_calls||[]).some(c=>c.function.name==='read_candidate')))return reply([call('submit_review',{output:{status:'content_issue',issues:[{location:'/goal',evidence:'not present XYZ',reason:'invalid',suggestion:'invalid'}],suggestions:[]}})]);return defaultAuthor(body,ctx)}})
 await f.run('source_analysis');const run=await f.production.run('adaptation_plan',{}, {...f.context,requestId:'invalid-review'}),detail=await f.production.wait(run.group_id);assert.equal(detail.status,'failed');assert.match(detail.reason,/审核证据/);assert.ok(detail.steps.some(s=>s.result?.candidate_ref));assert.ok(!detail.steps.some(s=>s.kind==='revise'));assert.ok((await f.project()).adaptation_plan.data.story_direction.main_plot)
})

test('共享图片立即落库、跨短剧绑定、非法图片/悬空ID和活动任务保护',async t=>{
 const f=await fixture(t),image=await f.production.images.put(f.png),p=await f.project()
 const asset={id:'prop_test',name:'蛇矛',description:'固定长矛',image_ids:[],selected_image_id:null}
 await f.edit({kind:'product',stage:'asset_preparation',expected_revision:0,value:{...p.asset_library,props:[asset]}})
 await f.edit({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:image.id});assert.equal((await f.project()).asset_library.props[0].selected_image_id,image.id)
 const created=await f.projects.create({name:'复用图库'},{sessionId:f.context.sessionId,requestId:'second-project'}),other={sessionId:created.session_id,projectId:created.project_id},p2=(await f.projects.snapshot(created.session_id)).project
 await f.projects.edit({kind:'product',stage:'asset_preparation',expected_revision:0,value:{...p2.asset_library,props:[{...asset,id:'prop_other'}]}},other)
 await f.projects.edit({kind:'image_select',stage:'asset_preparation',target_id:'prop_other',image_id:image.id},other);assert.equal(f.production.images.list().total,1)
 await assert.rejects(f.production.images.put(Buffer.from('not an image')),/失败|图片/)
 await assert.rejects(f.edit({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:'img_00000000-0000-0000-0000-000000000000'}),/不存在/)
 const response=await fetch(`${f.api}/production-file?session_id=${f.context.sessionId}&ref=..%2F..%2F.credentials.yaml`);assert.equal(response.status,422)
})


test('五个文本阶段均可按现有产物修订，独立审核的问题触发修订后重审',async t=>{
 const blocked=new Set(),f=await fixture(t,{author:async(body,ctx)=>{
  const catalog=JSON.parse(body.messages[1].content),last=body.messages.at(-1),key=catalog.stage+':'+catalog.unit.id
  if(catalog.action==='review'&&last.role==='tool'&&catalog.unit.kind!=='story_audit'&&!blocked.has(key)){
   const candidate=body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(r=>r.characters)?.body
   if(candidate){blocked.add(key);const value=JSON.parse(candidate),evidence=value.summary||value.creative_constraints?.style||value.segments?.[0]?.body||value.body||value.prompt||value.shots?.[0]?.beats[0]?.action;return reply([call('submit_review',{output:{status:'content_issue',issues:[{location:'当前候选',evidence,reason:'测试一次明确修订建议',suggestion:'保留有效情节并重新核对'}],suggestions:[]}})])}
  }
  return defaultAuthor(body,ctx)
 }})
 await f.run('source_analysis');for(const stage of ['adaptation_plan','story_segments','shot_design']){await f.run(stage);await f.run(stage,{revise:true});assert.ok(f.calls.some(c=>c.stage===stage&&c.action==='revise'))}
 await f.run('asset_preparation');let p=await f.project();for(const key of ['scenes','character_looks'])for(const asset of p.asset_library[key])await f.edit({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:asset.image_ids[0]});p=await f.project();await f.edit({kind:'confirm_stage',stage:'asset_preparation',expected_revision:projectNodeStates(p).asset_preparation.product_revision});await f.run('reference_binding');await f.run('clip_arrangement');await f.run('video_prompt');await f.run('video_prompt',{revise:true});assert.ok(f.calls.some(c=>c.stage==='video_prompt'&&c.action==='revise'))
})

test('未做原著解析也可直接以原件生成审核和修订改编规划',async t=>{
 const script='第一幕\r\n张飞说：“来战！”\n原件正文😀',f=await fixture(t,{script})
 const before=await f.project();assert.equal(before.source_analysis.chapters.length,0)
 const generated=await f.run('adaptation_plan');assert.equal(generated.status,'completed')
 await f.run('adaptation_plan',{revise:true})
 const after=await f.project();assert.equal(after.source_analysis.chapters.length,0);assert.equal(after.node_states.source_analysis.status,'empty')
 assert.ok(after.adaptation_plan.data.story_direction.main_plot)
 for(const action of ['generate','review','revise']){
  const calls=f.calls.filter(call=>call.stage==='adaptation_plan'&&call.action===action)
  assert.ok(calls.length)
  assert.ok(calls.some(call=>call.messages.some(message=>message.role==='tool'&&message.content.includes(JSON.stringify(script).slice(1,-1)))))
 }
})

test('取消中的请求不提交晚到候选，人工编辑清理节点检查点且不使用版本锁',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let block=true
 const f=await fixture(t,{script:'第一章\n张飞走进营帐。',author:async(body,ctx)=>{const catalog=JSON.parse(body.messages[1].content);if(block&&catalog.action==='generate'){entered();await gate}return defaultAuthor(body,ctx)}})
 await f.run('source_analysis');const run=await f.production.run('adaptation_plan',{}, {...f.context,requestId:'cancel-request'});await started;await f.production.cancel(run.group_id,f.context);release();const stopped=await f.production.wait(run.group_id);assert.equal(stopped.status,'cancelled');let p=await f.project();assert.equal(p.adaptation_plan.data.story_direction.main_plot,'');block=false
 // A normal candidate followed by review failure leaves an auditable checkpoint.
 const original=f.production.textClient;f.production.textClient={...original,turn:async args=>{if(JSON.parse(args.messages[1].content).action==='review')throw new Error('审核暂不可用');return original.turn(args)}}
 const broken=await f.production.run('adaptation_plan',{}, {...f.context,requestId:'checkpoint-request'});assert.equal((await f.production.wait(broken.group_id)).status,'failed');p=await f.project();assert.equal(projectNodeStates(p).adaptation_plan.checkpoint.state,'saved')
 await f.edit({kind:'product',stage:'adaptation_plan',expected_revision:projectNodeStates(p).adaptation_plan.product_revision,value:{...p.adaptation_plan.data,style:'人工修订规划'}})
 p=await f.project();assert.equal(p.adaptation_plan.state.checkpoint,null);assert.equal(Object.hasOwn(p.adaptation_plan.state,'product_revision'),false);f.production.textClient=original;const resumed=await f.production.run('adaptation_plan',{resume_of:broken.group_id},{...f.context,requestId:'resume-without-version'});assert.equal((await f.production.wait(resumed.group_id)).status,'completed')
})

test('10MiB无章节原文分段保存完整body，保持换行空白和UTF16，范围仅由程序派生',()=>{
 const text='  开头\r\n'+'原文😀。\n'.repeat(1000000)+'尾声未另起标题',chapters=sourceChapters(text)
 assert.ok(chapters.length>100);assertSourceText(text,chapters);assert.equal(chapters.map(c=>c.body).join(''),text);assert.ok(chapters.every(c=>Object.keys(c).sort().join(',')==='body,id,sequence,summary,title'&&c.body.length<=12000));assert.ok(chapters.every(c=>!/[\uD800-\uDBFF]$/.test(c.body)))
 const ranges=chapterRanges(chapters,'src');assertCoverage(text.length,ranges);assert.equal(readChapterText(chapters,ranges[0].end-5,ranges[0].end+5),text.slice(ranges[0].end-5,ranges[0].end+5));assert.throws(()=>readChapterText(chapters,0,16001),/最多16000/)
 const stable=sourceChapters(text,chapters);assert.deepEqual(stable.map(c=>c.id),chapters.map(c=>c.id));const renamed=chapters.map((c,i)=>i?c:{...c,title:'custom'});assert.equal(sourceChapters(text,renamed)[0].id,chapters[0].id);assert.equal(sourceChapters(text,renamed)[0].title,'custom');const reordered=[...chapters].reverse();assert.throws(()=>assertSourceText(text,reordered),/完整保留原稿/)
})

test('无辅助摘要可确认分段，改编规划读取原件而故事定稿按现行策略读取正文',async t=>{
 const f=await fixture(t),p=await f.project(),source=p.source.revisions[0],text=(await f.projects.documents.readArtifact(p.basic_info.id,source.file_ref)).toString(),chapters=sourceChapters(text).map(({summary,...chapter})=>chapter)
 await f.edit({kind:'product',stage:'source_analysis',expected_revision:0,value:{source_revision_id:source.id,chapters,coverage_ref:null}});let current=await f.project();await f.edit({kind:'confirm_stage',stage:'source_analysis',expected_revision:projectNodeStates(current).source_analysis.product_revision});await f.run('adaptation_plan');await f.run('story_segments');current=await f.project();assert.equal(current.source_analysis.chapters.map(c=>c.body).join(''),text);assert.equal(projectNodeStates(current).story_segments.status,'confirmed')
 for(const stage of ['adaptation_plan','story_segments']){const calls=f.calls.filter(c=>c.stage===stage),expected=stage==='adaptation_plan'?text:chapters[0].body;assert.ok(calls.some(c=>c.messages.some(m=>m.role==='tool'&&JSON.parse(m.content).body===expected)));assert.ok(calls.every(c=>JSON.parse(c.messages[1].content).unit_material_included))}
})

test('主会话按body指针分页读取正文，不要求原文文件引用',async t=>{
 const {ProductionContextTool}=await import('../src/main_agent/tools/production_tools.js'),f=await fixture(t),p=await f.project(),source=p.source.revisions[0],text=(await f.projects.documents.readArtifact(p.basic_info.id,source.file_ref)).toString(),chapters=sourceChapters(text)
 await f.edit({kind:'product',stage:'source_analysis',expected_revision:0,value:{source_revision_id:source.id,chapters,coverage_ref:null}});const tool=new ProductionContextTool(f.projects),exec={agent:{session:{id:f.context.sessionId}},callId:'read-body'}
 const page=JSON.parse(await tool.execute({pointer:'/source_analysis/chapters/0/body',start:2,end:8},exec));assert.equal(page.body,chapters[0].body.slice(2,8));assert.equal(page.characters,chapters[0].body.length);await assert.rejects(tool.execute({pointer:'/source_analysis/chapters/0/body',start:0,end:16001},exec),/最多16000/)
})

test('原著程序执行取消后不写回迟到原文，不调用模型',async t=>{
 const f=await fixture(t),p=await f.project(),ref=p.source.revisions[0].file_ref,original=f.projects.documents.readArtifact.bind(f.projects.documents);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r)
 f.projects.documents.readArtifact=async(id,path,...rest)=>{if(path===ref){entered();await gate}return original(id,path,...rest)}
 const run=await f.production.run('source_analysis',{}, {...f.context,requestId:'cancel-program-source'});await started;await f.production.cancel(run.group_id,f.context);release();const result=await f.production.wait(run.group_id);assert.equal(result.status,'cancelled');assert.equal((await f.project()).source_analysis.chapters.length,0);assert.equal(f.requests.length,0);assert.ok((await original(p.basic_info.id,ref)).length>0)
})

test('自主多段定稿支持相邻实际段审核修订，完整读取冻结全篇指导且ID保持',async t=>{
 let blocked=false
 const f=await fixture(t,{author:async(body,context)=>{
  const catalog=JSON.parse(body.messages[1].content)
  if(!blocked&&catalog.stage==='story_segments'&&catalog.unit.kind==='story_audit'&&catalog.action==='review'&&body.messages.at(-1).role==='tool'){
   const candidate=body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(r=>r.characters)?.body
   if(candidate){blocked=true;return reply([call('submit_review',{output:{status:'content_issue',issues:[{location:'/segments/0/body',evidence:JSON.parse(candidate).segments[0].body,reason:'测试相邻段位置衔接',suggestion:'核对并保留有效动作'}],suggestions:[]}})])}
  }
  return defaultAuthor(body,context)
 }})
 await f.run('source_analysis');await f.run('adaptation_plan');const detail=await f.run('story_segments'),before=await f.project()
 assert.equal(before.story_segments.segments.length,2);assert.ok(detail.steps.some(step=>step.kind==='revise'));assert.equal(detail.tasks[0].metadata.text_contract_version,3)
 const calls=f.calls.filter(call=>call.stage==='story_segments')
 assert.ok(calls.filter(call=>call.messages.some(message=>message.role==='tool')).every(call=>call.messages.some(message=>message.role==='tool'&&message.content.includes('以人物动机强化营帐对峙'))))
 await f.run('story_segments',{revise:true});const after=await f.project();assert.deepEqual(after.story_segments.segments.map(s=>s.id),before.story_segments.segments.map(s=>s.id));assert.ok(after.story_segments.segments.every(s=>s.adaptation_revision===after.adaptation_plan.revision&&!Object.hasOwn(s,'plan_item_id')))
})


test('定稿审核通过可携带润色建议，完整及相邻复核均不因此进入修订',async t=>{
 const f=await fixture(t,{author:async(body,context)=>{
  const message=await defaultAuthor(body,context),catalog=JSON.parse(body.messages[1].content)
  if(catalog.stage==='story_segments')for(const tool of message.tool_calls||[]){
   if(tool.function.name==='submit_review')tool.function.arguments=JSON.stringify({output:{status:'passed',issues:[],suggestions:['对白可更凝练，作为后续润色建议。']}})
  }
  return message
 }})
 await f.run('source_analysis');await f.run('adaptation_plan');const detail=await f.run('story_segments')
 const reviews=detail.steps.filter(step=>step.result?.review)
 assert.ok(reviews.length>=2);assert.ok(reviews.every(step=>step.result.review.status==='passed'&&step.result.review.suggestions.length===1))
 assert.equal(detail.steps.some(step=>step.kind==='revise'),false)
 assert.equal((await f.project()).story_segments.segments.length,2)
})

test('素材只生成一部分保持未完成，所需图片齐全后无需选图或审核直接通过',async t=>{
 const f=await fixture(t);await f.run('source_analysis');await f.run('adaptation_plan');await f.run('story_segments');await f.run('shot_design')
 let p=await f.project();const scene=p.asset_library.scenes[0],look=p.asset_library.character_looks[0]
 const first=await f.run('asset_preparation',{target_id:scene.id});p=await f.project();assert.equal(projectNodeStates(p).asset_preparation.status,'partial');assert.match(projectNodeStates(p).asset_preparation.reason,/未准备/);assert.equal(first.steps.at(-1).result.requires_confirmation,false)
 const second=await f.run('asset_preparation',{target_id:look.id});p=await f.project();assert.equal(projectNodeStates(p).asset_preparation.status,'confirmed');assert.equal(p.asset_library.scenes[0].selected_image_id,null);assert.equal(p.asset_library.character_looks[0].selected_image_id,null)
 assert.ok(second.steps.every(step=>step.kind!=='review'));assert.equal(second.steps.at(-1).result.requires_confirmation,false)
 const count=f.requests.filter(row=>row.path==='/images/generations').length;await f.run('asset_preparation');assert.equal(f.requests.filter(row=>row.path==='/images/generations').length,count,'已有图片只更新完成状态，不重复生成')
 await f.edit({kind:'image_select',stage:'asset_preparation',target_id:scene.id,image_id:p.asset_library.scenes[0].image_ids[0]});assert.equal((await f.project()).node_states.asset_preparation.status,'confirmed')
})

test('素材图片请求失败保留失败状态，不显示生成通过',async t=>{
 const f=await fixture(t);await f.run('source_analysis');await f.run('adaptation_plan');await f.run('story_segments');await f.run('shot_design')
 f.models.generateImage=async()=>{throw new Error('测试图片服务失败')}
 const started=await f.production.run('asset_preparation',{}, {...f.context,requestId:'image-failed'}),detail=await f.production.wait(started.group_id),p=await f.project()
 assert.equal(detail.status,'failed');assert.match(detail.reason,/图片服务失败/);assert.notEqual(projectNodeStates(p).asset_preparation.status,'confirmed');assert.equal(f.production.images.list().total,0)
})

test('素材生成通过后无需手动逐图选用即可执行参考确认，绑定与默认选图正式保存',async t=>{
 const f=await fixture(t);await f.run('source_analysis');await f.run('adaptation_plan');await f.run('story_segments');await f.run('shot_design');await f.run('asset_preparation')
 const before=await f.project(),imageRequests=f.requests.filter(r=>r.path==='/images/generations').length
 assert.equal(before.asset_library.scenes[0].selected_image_id,null);assert.equal(before.asset_library.character_looks[0].selected_image_id,null)
 await f.run('reference_binding');const after=await f.project();assert.equal(projectNodeStates(after).reference_binding.status,'confirmed');assert.ok(after.shot_design.shots.every(s=>s.reference_images.length===2));assert.equal(after.asset_library.scenes[0].selected_image_id,after.asset_library.scenes[0].image_ids[0]);assert.equal(after.asset_library.character_looks[0].selected_image_id,after.asset_library.character_looks[0].image_ids[0])
 assert.ok(projectNodeStates(after).asset_preparation.product_revision>projectNodeStates(before).asset_preparation.product_revision);assert.equal(f.requests.filter(r=>r.path==='/images/generations').length,imageRequests)
 await f.run('clip_arrangement');assert.ok((await f.project()).clip_arrangement.clips.length)
})
