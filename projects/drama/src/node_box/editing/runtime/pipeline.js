import {uid} from '../../../shared/production/execution_support.js'
import {srtTime} from '../../../shared/media/media.js'
export async function subtitleText(service,project,timeline){
  const lines=[]
  for(const edit of timeline.clips){const take=project.videos.find(v=>v.id===edit.take_id),snapshot=JSON.parse((await service.projects.documents.readArtifact(project.basic_info.id,take.input_snapshot_ref)).toString()),clip=snapshot.clip,shots=snapshot.shots;const beats=clip.sources.flatMap(s=>shots.find(shot=>shot.id===s.shot_id).beats.filter(b=>s.beat_ids.includes(b.id))),total=beats.reduce((n,b)=>n+b.duration_seconds,0);let cursor=0
    for(const beat of beats){const start=cursor/total*take.duration_seconds,end=(cursor+beat.duration_seconds)/total*take.duration_seconds;cursor+=beat.duration_seconds
      const duration=(end-start)/Math.max(1,beat.dialogues.length)
      beat.dialogues.forEach((line,index)=>{const a=Math.max(start+index*duration,edit.in_seconds),b=Math.min(start+(index+1)*duration,edit.out_seconds);if(b>a)lines.push({start:edit.position_seconds+a-edit.in_seconds,end:edit.position_seconds+b-edit.in_seconds,text:line.text})})
    }
  }
  return lines.sort((a,b)=>a.start-b.start).map((line,index)=>`${index+1}\n${srtTime(line.start)} --> ${srtTime(line.end)}\n${line.text.replaceAll('-->','→')}\n`).join('\n')
}
export async function buildTimeline(service,project){
  let position=0;const clips=[]
  for(const clip of [...project.clip_arrangement.clips].sort((a,b)=>a.sequence-b.sequence)){const selected=project.videos.filter(v=>v.clip_id===clip.id&&v.status==='approved');if(selected.length!==1)throw new TypeError(`分片${clip.id}需要且只能有一个人工选用视频`);const take=selected[0];clips.push({id:uid('edit'),take_id:take.id,in_seconds:0,out_seconds:take.duration_seconds,position_seconds:position});position+=take.duration_seconds}
  if(!clips.length)throw new TypeError('没有可剪辑素材')
  const timeline={id:project.editing.timelines[0]?.id||uid('timeline'),name:'连续成片',revision:(project.editing.timelines[0]?.revision||0)+1,clips,transitions:[],subtitles_ref:null,audio_tracks_ref:null}
  timeline.subtitles_ref=await service.projects.documents.writeArtifact(project.basic_info.id,await subtitleText(service,project,timeline),{extension:'srt'})
  return timeline
}
