import {uid} from '../../shared/production/execution_support.js'
import {assertSourceText} from '../../../shared/text/source.js'

export async function executeUnit(ctx){const id=ctx.task.metadata.project_id;let project=await this.projects.documents.read(id),result;
      const source=project.source.revisions.find(row=>row.id===project.source.current_revision_id)
      if(!source&&project.basic_info.creation_mode!=='自由创作')throw new TypeError('请先导入原稿')
      const body=source?(await this.projects.documents.readArtifact(id,source.file_ref)).toString():''
      const previous=project.source_analysis.chapters.length===1&&project.source_analysis.chapters[0].body===body?project.source_analysis.chapters[0]:null
      const chapters=source?[{id:previous?.id||uid('chapter'),sequence:1,title:previous?.title||source.original_name||project.basic_info.name,body,summary:''}]:[]
      if(source)assertSourceText(body,chapters)
      await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.source_analysis={source_revision_id:source?.id||null,chapters,coverage_ref:null};p.node_states.source_analysis.product_revision++;return p})
      result={saved:true,chapters:chapters.length,characters:body.length}

return result
}
