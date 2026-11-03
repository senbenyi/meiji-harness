import {upsert} from '../../../shared/text/source.js'
import {buildTimeline} from './pipeline.js'
import {renderTimeline} from '../../../shared/media/timeline_renderer.js'

export async function executeUnit(ctx){const id=ctx.task.metadata.project_id;let project=await this.projects.documents.read(id),result;
      if(project.node_states.video_render.status!=='confirmed')throw new TypeError('请先检查并选用所有分片视频')
      let timeline=ctx.task.metadata.options.use_existing?project.editing.timelines.find(t=>!ctx.task.metadata.options.timeline_id||t.id===ctx.task.metadata.options.timeline_id):await buildTimeline(this.service,project)
      if(!timeline)throw new TypeError('时间线不存在')
      // 先保存时间线，渲染失败也保留人工可继续的编辑产物。
      await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.editing.timelines=upsert(p.editing.timelines,[timeline]);p.node_states.editing.product_revision++;return p});project=await this.projects.documents.read(id)
      const rendered=await renderTimeline(this.service,ctx,project,timeline),file_ref=await this.projects.documents.writeArtifact(id,rendered.bytes,{kind:'media',extension:'mp4'})
      const report_ref=await this.projects.documents.writeArtifact(id,JSON.stringify(rendered.validation),{extension:'json'})
      await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.editing.preview_ref=file_ref;return p});result={saved:true,file_ref,report_ref,timeline_id:timeline.id}

return result
}
