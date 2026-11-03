import {importAudio} from '../../../shared/media/audio_import.js'
import {readJSON} from '../../../shared/production/execution_support.js'
import {subtitleText} from './pipeline.js'
export async function manual(ctx,command){const {projects}=this,id=ctx.task.metadata.project_id;
if(command.kind==='regenerate_subtitles')return {next:await projects.documents.mutate(id,async p=>{ctx.signal.throwIfAborted();const timeline=p.editing.timelines.find(t=>t.id===command.timeline_id);if(!timeline)throw new TypeError('时间线不存在');timeline.subtitles_ref=await projects.documents.writeArtifact(id,await subtitleText(this,p,timeline),{extension:'srt'});timeline.revision++;p.node_states.editing.product_revision++;p.node_states.editing.status='draft';return p})}
if(command.kind==='audio_import'){const {file_ref,media}=await importAudio(projects,id,ctx,command);const next=await projects.documents.mutate(id,async p=>{ctx.signal.throwIfAborted();const timeline=p.editing.timelines.find(t=>t.id===command.timeline_id);if(!timeline)throw new TypeError('时间线不存在');const tracks=timeline.audio_tracks_ref?await readJSON(projects,id,timeline.audio_tracks_ref):[];tracks.push({file_ref,position_seconds:0,in_seconds:0,out_seconds:media.duration,gain_db:0});timeline.audio_tracks_ref=await projects.documents.writeArtifact(id,JSON.stringify(tracks),{extension:'json'});timeline.revision++;p.node_states.editing.product_revision++;p.node_states.editing.status='draft';return p});return {next,result:{file_ref,duration_seconds:media.duration}}}
throw new TypeError('未知节点人工操作')
}
