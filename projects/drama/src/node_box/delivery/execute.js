import {uid} from '../../production/execution_support.js'
import {renderTimeline} from '../../production/timeline_renderer.js'

export async function executeUnit(ctx){const id=ctx.task.metadata.project_id;let project=await this.projects.documents.read(id),result;
      if(project.node_states.editing.status!=='confirmed')throw new TypeError('请先确认连续剪辑')
      const timeline=project.editing.timelines.find(t=>!ctx.task.metadata.options.timeline_id||t.id===ctx.task.metadata.options.timeline_id);if(!timeline)throw new TypeError('时间线不存在')
      const duration=Math.max(...timeline.clips.map(c=>c.position_seconds+c.out_seconds-c.in_seconds));let episodes=project.episodes.filter(e=>e.timeline_id===timeline.id)
      const target=ctx.task.metadata.options.episode_seconds
      if(target!==undefined&&(!Number.isFinite(target)||target<4||target>86400))throw new TypeError('分集目标时长需4～86400秒')
      if(target){episodes=[];let start=0,index=1;const boundaries=timeline.clips.map(c=>c.position_seconds+c.out_seconds-c.in_seconds).sort((a,b)=>a-b);while(start<duration-0.01){const options=boundaries.filter(b=>b>start+0.01),end=options.reduce((best,value)=>Math.abs(value-(start+target))<Math.abs(best-(start+target))?value:best,options[0]);episodes.push({id:uid('episode'),title:`第${index++}集`,timeline_id:timeline.id,start_seconds:start,end_seconds:end});start=end}}
      if(!episodes.length)episodes=[{id:uid('episode'),title:'完整成片',timeline_id:timeline.id,start_seconds:0,end_seconds:duration}]
      const sorted=[...episodes].sort((a,b)=>a.start_seconds-b.start_seconds);let cursor=0;for(const episode of sorted){if(Math.abs(episode.start_seconds-cursor)>0.05)throw new TypeError('最终分集必须无间隙无重叠覆盖连续成片');cursor=episode.end_seconds}if(Math.abs(cursor-duration)>0.05)throw new TypeError('分集未覆盖完整成片')
      await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.episodes=[...p.episodes.filter(e=>e.timeline_id!==timeline.id),...episodes];return p})
      const exports=[]
      for(const episode of sorted){ctx.signal.throwIfAborted();const input_snapshot_ref=await this.projects.documents.writeArtifact(id,JSON.stringify({episode,timeline,settings:project.delivery.settings}),{extension:'json'}),rendered=await renderTimeline(this.service,ctx,project,timeline,{start:episode.start_seconds,end:episode.end_seconds}),file_ref=await this.projects.documents.writeArtifact(id,rendered.bytes,{kind:'exports',extension:'mp4'}),settings_ref=await this.projects.documents.writeArtifact(id,JSON.stringify(project.delivery.settings),{extension:'json'}),validation_report_ref=await this.projects.documents.writeArtifact(id,JSON.stringify(rendered.validation),{extension:'json'}),subtitles_ref=rendered.subtitles.trim()?await this.projects.documents.writeArtifact(id,rendered.subtitles,{kind:'exports',extension:'srt'}):null,entry={id:uid('export'),timeline_id:timeline.id,episode_id:episode.id,input_snapshot_ref,file_ref,subtitles_ref,settings_ref,validation_report_ref};exports.push(entry);await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.delivery.exports.push(entry);p.node_states.delivery.product_revision++;return p})}
      result={saved:true,exports:exports.map(e=>({id:e.id,file_ref:e.file_ref})),subtitle_ref:timeline.subtitles_ref}
    
return result
}
