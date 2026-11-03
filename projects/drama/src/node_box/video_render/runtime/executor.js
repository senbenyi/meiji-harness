import {mediaMemory} from '../../../memory/service.js'
import {UnitProductionExecutor} from '../../../shared/production/unit_executor.js'
import {uid,readJSON} from '../../../shared/production/execution_support.js'
import {probeBytes} from '../../../shared/media/media.js'
import {upsert} from '../../../shared/text/source.js'

/** 视频盒子：分片/声音预检、调用视频模型、下载技术校验，等待人工选用。 */
export class VideoProductionExecutor extends UnitProductionExecutor {
  constructor(service){super(service,['video_render'])}
  async createUnits(_ctx,project,input){
    if(project.node_states.video_prompt.status!=='confirmed')throw new TypeError('请先完成并确认视频提示词')
    if(input.unit_id&&!project.clip_arrangement.clips.some(c=>c.id===input.unit_id))throw new TypeError('指定分片不存在')
    return project.clip_arrangement.clips.filter(clip=>(!input.unit_id||clip.id===input.unit_id)&&(input.regenerate||!project.videos.some(v=>v.clip_id===clip.id))).map(clip=>({id:uid('unit'),clip_id:clip.id,take_id:uid('take'),operation_id:uid('op'),has_dialogue:clip.sources.some(s=>project.shot_design.shots.find(shot=>shot.id===s.shot_id).beats.some(b=>s.beat_ids.includes(b.id)&&b.dialogues.length))}))
  }
  requiresConfirmation(ctx,project){return ctx.previousResults.some(s=>s.result?.requires_confirmation)||project.clip_arrangement.clips.some(c=>!project.videos.some(v=>v.clip_id===c.id&&v.status==='approved'))}
  async executeUnit(ctx){
    const unit=await readJSON(this.projects,ctx.task.metadata.project_id,ctx.step.metadata.unit_ref)
    const service=this.service,{projects,images,models}=service,id=ctx.task.metadata.project_id,project=await projects.documents.read(id),clip=project.clip_arrangement.clips.find(c=>c.id===unit.clip_id),prompt=project.video_prompt.items.find(p=>p.clip_id===clip?.id)
    if(prompt&&prompt.mode!==clip?.mode)throw new TypeError('分片模式已变化，请重新生成此分片提示词')
    if(!clip||!prompt)throw new TypeError('分片缺少已保存提示词')
    const cached=project.videos.find(v=>v.id===unit.take_id);if(cached){await projects.documents.readArtifact(id,cached.file_ref);return this.acceptUnit(ctx,{saved:true,reused:true,take_id:cached.id,file_ref:cached.file_ref,requires_confirmation:cached.status!=='approved',input_snapshot_ref:cached.input_snapshot_ref})}
    const options={mode:clip.mode,prompt:[await mediaMemory(projects,ctx.task),(await projects.documents.readArtifact(id,prompt.prompt_ref)).toString(),ctx.task.metadata.instruction?`本次补充意见：${ctx.task.metadata.instruction}`:''].filter(Boolean).join('\n'),duration:clip.duration_seconds,aspectRatio:project.basic_info.aspect_ratio}
    const lines=clip.sources.flatMap(s=>project.shot_design.shots.find(shot=>shot.id===s.shot_id).beats.filter(b=>s.beat_ids.includes(b.id)).flatMap(b=>b.dialogues));if(lines.some(line=>!options.prompt.includes(line.text)))throw new TypeError('当前提示词遗漏最新对白，请先重新生成提示词')
    for(const voice of prompt.voice_references){const profile=project.asset_library.characters.find(c=>c.id===voice.character_id)?.voice_profile;if(!profile||profile.revision!==voice.voice_revision||profile.reference_audio_ref!==voice.audio_ref)throw new TypeError('音色样本已变化，请先重新生成提示词')}
    const actual_prompt_ref=await projects.documents.writeArtifact(id,options.prompt)
    const imageUrl=async imageId=>`data:image/png;base64,${(await images.read(imageId)).toString('base64')}`
    if(clip.mode==='reference'){
      options.referenceImages=await Promise.all(prompt.reference_images.map(row=>imageUrl(row.image_id)))
      if(prompt.voice_references.length){let seconds=0;options.referenceAudios=[]
        for(const voice of prompt.voice_references){const bytes=await projects.documents.readArtifact(id,voice.audio_ref),media=await probeBytes(bytes,'wav',{signal:ctx.signal});if(!media.audio||media.duration<2||media.duration>15)throw new TypeError('音色样本需为2～15秒音频');seconds+=media.duration;options.referenceAudios.push(`data:audio/${voice.audio_ref.endsWith('.mp3')?'mpeg':'wav'};base64,${bytes.toString('base64')}`)}
        if(seconds>15.05)throw new TypeError('音色参考合计不能超过15秒')
      }
    }else if(clip.mode==='first_frame'){options.inputReference=await imageUrl(clip.first_image_id);if(clip.last_image_id)options.lastFrame=await imageUrl(clip.last_image_id)}
    const snapshotRef=await projects.documents.writeArtifact(id,JSON.stringify({memory_snapshot_ref:ctx.task.metadata.memory_snapshot_ref||null,clip,prompt,actual_prompt_ref,shots:project.shot_design.shots.filter(shot=>clip.sources.some(source=>source.shot_id===shot.id)),reference_image_ids:prompt.reference_images.map(r=>r.image_id),voice_references:prompt.voice_references}),{extension:'json'})
    const config=await models.read();ctx.recordPrompt({model:config.video.model,messages:[{role:'user',content:JSON.stringify({snapshot_ref:snapshotRef})}],input:{snapshot_ref:snapshotRef}})
    const generated=await models.generateVideo({...options,requestId:unit.operation_id,signal:ctx.signal,record:service.recorder(ctx)})
    const bytes=await service.mediaClient.downloadVideo({url:generated.url,signal:ctx.signal,record:service.recorder(ctx)}),media=await probeBytes(bytes,'mp4',{signal:ctx.signal})
    if(!media.video||!media.audio&&unit.has_dialogue||!Number.isFinite(media.duration)||media.duration<=0||Math.abs(media.duration-clip.duration_seconds)>0.75)throw new TypeError('生成视频未通过技术验证（视频/对白音轨/时长）')
    const file_ref=await projects.documents.writeArtifact(id,bytes,{kind:'media',extension:'mp4'}),take={id:unit.take_id,clip_id:clip.id,mode:clip.mode,prompt_id:prompt.id,prompt_revision:prompt.revision,file_ref,duration_seconds:media.duration,input_snapshot_ref:snapshotRef,reference_image_ids:prompt.reference_images.map(r=>r.image_id),voice_references:prompt.voice_references,status:'candidate'}
    await projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.videos=upsert(p.videos,[take]);p.node_states.video_render.product_revision++;p.node_states.video_render.status='partial';p.node_states.video_render.reason='技术校验通过，请检查画面、对白、声线与连续性后选用';return p})
    return this.acceptUnit(ctx,{saved:true,take_id:take.id,file_ref,remote_task_id:generated.taskId,snapshot_ref:snapshotRef,requires_confirmation:true,technical_validation:{video:true,audio:!!media.audio,duration_seconds:media.duration}})
  }
}
