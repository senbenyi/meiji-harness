import {projectNodeStates} from '../../../shared/production/production_stages.js'
import {uid} from '../../shared/production/execution_support.js'
export const requireSourceCoverage=true

export function applyCandidate(next,unit,output,files={}){
    if(['style','audience'].some(key=>!output[key].trim()))throw new TypeError('改编定位必须明确风格和受众')
    if(!output.story_direction.main_plot.trim())throw new TypeError('请提供完整的故事主线方向')
    for(const key of ['constraints','must_preserve'])if(next.adaptation_plan.data.story_direction[key].some(rule=>!output.story_direction[key].includes(rule)))throw new TypeError('不能丢失既有创作约束或必须保留的情节')
    if(next.source.current_revision_id){
      if(!output.character_plans.length)throw new TypeError('有原稿的联合改编必须提供主要人物规划，不能提交空的character_plans')
      if(!output.scene_plans.length)throw new TypeError('有原稿的联合改编必须提供关键场景规划，不能提交空的scene_plans')
    }
    next.adaptation_plan.data=structuredClone(output)

}
export async function prepareText(projects,project,input,{signal}={}){
 const units=[],source=project.source.revisions.find(row=>row.id===project.source.current_revision_id);
    if(project.source.current_revision_id&&!source)throw new TypeError('当前剧本原件不存在')
    if(input.unit_id&&input.unit_id!=='global')throw new TypeError('联合改编只生成全篇指导，不支持章节或段计划单元')
    units.push({id:uid('unit'),kind:'guidance',source_spans:source?[{source_revision_id:source.id,start:0,end:source.character_count}]:[],material:{goal:input.instruction||projectNodeStates(project).adaptation_plan.opinion||'确定受众、风格、故事方向和人物团队场景改编方案',...(source?{source_ref:source.file_ref,source_characters:source.character_count}:{}),existing_guidance_ref:'snapshot:/adaptation_plan/data',instruction:'用read_source或read_file分页完整读取导入的剧本原件，不使用原著解析正文或摘要替代。形成受众、风格、故事方向、人物规划、团队规划、场景规划。主线方向用连贯文本写清主角目标、核心冲突、因果推进和结局方向，将必要转折与高潮融入主线；不展开详细故事，不预先规定故事段数与分段边界。分别列出必须保留的情节与创作约束。人物、团队、场景每项仅写original_content与adaptation_plan，明确具体改编对象及方案，不输出ID，不创建资产。故事分段定稿据此自主分段。'}})

 if(input.unit_id&&units.length===0)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
  const {audience,style,story_direction,character_plans,scene_plans,group_plans}=project.adaptation_plan.data
  return {audience,style,story_direction,character_plans,group_plans,scene_plans}

}
export async function writeCandidateFiles(projects,projectId,output){const files={};;return files}
