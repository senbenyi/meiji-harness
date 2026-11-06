import {projectNodeStates} from '../src/shared/production/production_stages.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixture} from './helpers/production-fixture.js'
import {projectStages} from '../src/shared/production/production_stages.js'

const forbidden=kind=>async()=>{throw new Error(`不应调用${kind}模型`)}

test('制作步骤选择所属类型执行器，错误类型和内部步骤不能绕过入口',async t=>{
  const f=await fixture(t),service=f.production
  assert.equal(service.executors.size,projectStages.length-1)
  const text=service.executorFor('adaptation_plan'),image=service.executorFor('asset_preparation'),video=service.executorFor('video_render'),program=service.executorFor('editing')
  assert.equal(new Set([text,image,video,program]).size,4);assert.equal(service.executorFor('source_analysis'),program)
  assert.throws(()=>service.executorFor('project'),/未知制作步骤/)
  assert.throws(()=>service.plan({node_type:'missing',metadata:{production:true}}),/未知制作步骤/)
  const ctx={signal:new AbortController().signal,task:{node_type:'asset_preparation',metadata:{session_id:f.context.sessionId,project_id:f.context.projectId}},step:{kind:'review'}}
  await assert.rejects(text.execute(ctx),/不支持制作步骤/)
  await assert.rejects(video.execute(ctx),/不支持制作步骤/)
  await assert.rejects(program.execute(ctx),/不支持制作步骤/)
  await assert.rejects(image.execute(ctx),/不支持内部步骤/)
  assert.equal(f.requests.length,0,'类型拒绝应发生在任何模型调用前')
  // 手工编辑仍走程序保存，不受对应制作类型的生成步骤约束。
  const p=await f.project();await f.edit({kind:'node_opinion',node_type:'asset_preparation',value:'人工意见',previousValue:projectNodeStates(p).asset_preparation.opinion});assert.equal((await f.project()).node_states.asset_preparation.opinion,'人工意见')
})

test('各类型只调用自己的模型；图片/视频失败续接保留已完成单元，程序后期不调用模型',async t=>{
  const f=await fixture(t),service=f.production,models=f.models,original={text:service.textClient,image:models.generateImage,video:models.generateVideo,download:service.mediaClient}
  models.generateImage=forbidden('图片');models.generateVideo=forbidden('视频')
  const prepared=await f.run('source_analysis');assert.deepEqual(prepared.steps.map(s=>s.kind),['prepare','execute','finish']);assert.equal(f.requests.length,0);
  for(const stage of ['adaptation_plan','story_segments','shot_design']){
    const result=await f.run(stage);assert.ok(result.steps.some(s=>s.kind==='generate'));assert.ok(result.steps.some(s=>s.kind==='review'))
  }
  service.textClient={turn:forbidden('文本')};let imageCalls=0
  models.generateImage=async args=>{if(++imageCalls===2)throw new Error('第二张图片模拟失败');return original.image(args)}
  let result=await service.run('asset_preparation',{}, {...f.context,requestId:randomUUID()}),detail=await service.wait(result.group_id);assert.equal(detail.status,'failed');assert.equal(f.production.images.list().total,1)
  const imageCount=f.requests.filter(r=>r.path==='/images/generations').length
  models.generateImage=original.image;detail=await f.run('asset_preparation',{resume_of:result.group_id});assert.equal(f.requests.filter(r=>r.path==='/images/generations').length,imageCount+1,'续接只补未完成图片');assert.ok(!detail.steps.some(s=>['generate','review','revise'].includes(s.kind)))
  let p=await f.project();for(const key of ['scenes','character_looks'])for(const asset of p.asset_library[key])await f.edit({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:asset.image_ids[0]});p=await f.project();await f.edit({kind:'confirm_stage',stage:'asset_preparation',expected_revision:projectNodeStates(p).asset_preparation.product_revision})
  models.generateImage=forbidden('图片');await f.run('reference_binding');await f.run('clip_arrangement')
  service.textClient=original.text;await f.run('video_prompt');service.textClient={turn:forbidden('文本')}
  let videoCalls=0;models.generateVideo=async args=>{if(++videoCalls===2)throw new Error('第二段视频模拟失败');return original.video(args)}
  result=await service.run('video_render',{}, {...f.context,requestId:randomUUID()});detail=await service.wait(result.group_id);assert.equal(detail.status,'failed');p=await f.project();assert.equal(p.videos.length,1)
  const takeId=p.videos[0].id,videoCount=f.requests.filter(r=>r.path==='/videos/generations').length
  models.generateVideo=original.video;await f.run('video_render',{resume_of:result.group_id});p=await f.project();assert.equal(p.videos.length,2);assert.ok(p.videos.some(t=>t.id===takeId));assert.equal(f.requests.filter(r=>r.path==='/videos/generations').length,videoCount+1,'续接不重做已有视频')
  for(const take of p.videos)await f.edit({kind:'video_select',stage:'video_render',take_id:take.id});p=await f.project();await f.edit({kind:'confirm_stage',stage:'video_render',expected_revision:projectNodeStates(p).video_render.product_revision})
  models.generateVideo=forbidden('视频');service.mediaClient={downloadVideo:forbidden('视频下载')};await f.edit({kind:'product',stage:'delivery',expected_revision:projectNodeStates(p).delivery.product_revision,value:{episodes:[],delivery:{...p.delivery,settings:{width:64,height:64,fps:10,subtitle_mode:'sidecar',normalize_audio:true}}}})
  const requestCount=f.requests.length;for(const stage of ['editing','delivery']){const result=await f.run(stage);assert.ok(result.steps.some(s=>s.kind==='execute'));assert.ok(!result.steps.some(s=>['generate','review','revise'].includes(s.kind)))}assert.equal(f.requests.length,requestCount,'实际剪辑导出不得发起模型请求');assert.equal((await f.project()).delivery.exports.length,1)
})
