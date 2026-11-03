import {importAudio} from '../../shared/media/audio_import.js'
import {findAsset} from './assets.js'
import {probeBytes,command as mediaCommand,withTemporary} from '../../../shared/media/media.js'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
const commandMedia=(args,signal)=>mediaCommand('ffmpeg',args,{signal})
export async function manual(ctx,command){const {projects}=this,id=ctx.task.metadata.project_id;
if(['image_import','image_select'].includes(command.kind)){
      const project=await projects.documents.read(id);findAsset(project,command.target_id)
      const image=command.kind==='image_import'?await this.images.put(Buffer.from(command.base64||'','base64'),{signal:ctx.signal}):this.images.get(command.image_id)
      const next=await projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();const asset=findAsset(p,command.target_id).asset;if(!asset.image_ids.includes(image.id))asset.image_ids.push(image.id);asset.selected_image_id=image.id
        if(command.use_for_character&&findAsset(p,command.target_id).kind==='character_looks'){const character=findAsset(p,asset.character_id).asset;if(!character.image_ids.includes(image.id))character.image_ids.push(image.id);character.selected_image_id=image.id}
        for(const requirement of p.asset_requirements.items)if(requirement.target_id===asset.id){requirement.status='ready';requirement.image_id=image.id}
        p.node_states.asset_preparation.product_revision++;p.node_states.asset_preparation.status='draft';p.node_states.asset_preparation.reason='素材选用已保存，待整体确认';return p})
      return {next,result:{image_id:image.id}}
    }
if(command.kind==='voice_extract'){
      if(!command.confirmed_clean)throw new TypeError('请人工确认截取范围为单人干净声音')
      const project=await projects.documents.read(id),take=project.videos.find(v=>v.id===command.take_id)
      const start=command.start_seconds,end=command.end_seconds
      if(!take||take.status!=='approved'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>take.duration_seconds+0.01||end-start<2||end-start>15)throw new TypeError('从已选视频中截取2～15秒声线样本')
      const bytes=await projects.documents.readArtifact(id,take.file_ref),audio=await withTemporary(async root=>{const input=join(root,'source.mp4'),output=join(root,'voice.wav');await writeFile(input,bytes);await commandMedia(['-v','error','-ss',String(start),'-i',input,'-t',String(end-start),'-vn','-ar','48000','-ac','1','-y',output],ctx.signal);return readFile(output)})
      const info=await probeBytes(audio,'wav',{signal:ctx.signal});if(!info.audio||info.duration<1.99||info.duration>15.01)throw new TypeError('截取音频验证失败')
      const file_ref=await projects.documents.writeArtifact(id,audio,{kind:'audio',extension:'wav'}),next=await projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();const character=p.asset_library.characters.find(c=>c.id===command.character_id);if(!character)throw new TypeError('人物不存在');character.voice_profile.reference_audio_ref=file_ref;character.voice_profile.revision++;p.node_states.asset_preparation.product_revision++;p.node_states.asset_preparation.status='draft';return p})
      return {next,result:{file_ref,duration_seconds:info.duration,source_take_id:take.id,start_seconds:start,end_seconds:end}}
    }
if(command.kind==='audio_import'){if(!command.confirmed_clean)throw new TypeError('请先人工确认样本为单人干净声线');const {file_ref,media}=await importAudio(projects,id,ctx,command,{minimum:2,maximum:15,invalidMessage:'声线样本需2～15秒有效音频'});const next=await projects.documents.mutate(id,async p=>{ctx.signal.throwIfAborted();const character=p.asset_library.characters.find(c=>c.id===command.character_id);if(!character)throw new TypeError('人物不存在');character.voice_profile.reference_audio_ref=file_ref;character.voice_profile.revision++;p.node_states.asset_preparation.product_revision++;p.node_states.asset_preparation.status='draft';return p});return {next,result:{file_ref,duration_seconds:media.duration}}}
throw new TypeError('未知节点人工操作')
}
