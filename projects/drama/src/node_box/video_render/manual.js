import {randomUUID} from 'node:crypto'
import {probeBytes,command as mediaCommand} from '../../production/media.js'
const commandMedia=(args,signal)=>mediaCommand('ffmpeg',args,{signal})
export async function manual(ctx,command){const {projects}=this,id=ctx.task.metadata.project_id;
if(command.kind==='video_reject')return {next:await projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();const take=p.videos.find(v=>v.id===command.take_id);if(!take)throw new TypeError('视频不存在');take.status='rejected';p.node_states.video_render.product_revision++;p.node_states.video_render.status='draft';return p})}
if(command.kind==='video_select')return {next:await projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();const take=p.videos.find(v=>v.id===command.take_id);if(!take)throw new TypeError('视频候选不存在');for(const row of p.videos.filter(v=>v.clip_id===take.clip_id))row.status=row.id===take.id?'approved':row.status==='approved'?'candidate':row.status;p.node_states.video_render.product_revision++;p.node_states.video_render.status='draft';return p})}
if(command.kind==='video_import'){
      const p=await projects.documents.read(id),clip=p.clip_arrangement.clips.find(c=>c.id===command.clip_id),prompt=p.video_prompt.items.find(i=>i.clip_id===clip?.id);if(!clip||!prompt)throw new TypeError('导入视频需要已有分片与提示词')
      const input_snapshot_ref=await projects.documents.writeArtifact(id,JSON.stringify({origin:'import',clip,prompt,actual_prompt_ref:prompt.prompt_ref,shots:p.shot_design.shots.filter(shot=>clip.sources.some(s=>s.shot_id===shot.id))}),{extension:'json'});const bytes=Buffer.from(command.base64||'','base64');if(!bytes.length||bytes.length>48*1024*1024)throw new TypeError('导入视频最多48MiB')
      const media=await probeBytes(bytes,'mp4',{signal:ctx.signal});if(!media.video||media.duration<=0)throw new TypeError('无效视频')
      const file_ref=await projects.documents.writeArtifact(id,bytes,{kind:'media',extension:'mp4'}),take={id:`take_${randomUUID()}`,clip_id:clip.id,mode:clip.mode,prompt_id:prompt.id,prompt_revision:prompt.revision,file_ref,duration_seconds:media.duration,input_snapshot_ref,reference_image_ids:prompt.reference_images.map(r=>r.image_id),voice_references:prompt.voice_references,status:'candidate'}
      return {next:await projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.videos.push(take);p.node_states.video_render.product_revision++;p.node_states.video_render.status='draft';return p}),result:{take_id:take.id,file_ref}}
    }
throw new TypeError('未知节点人工操作')
}
