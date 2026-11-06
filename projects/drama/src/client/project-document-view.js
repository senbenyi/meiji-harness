import {renderShotList} from '../node_box/shot_design/ui/shot-list.js'
import {scriptImport} from '../node_box/project/ui/panel/script-import.js'
import {projectDialog} from '../node_box/project/ui/panel/project-forms.js'
import {createMemoryPanel} from './memory-panel.js'
import {productionControls} from './production-controls.js'
import {element,showPanelDialog} from './ui/panel-dom.js'
import {readable} from './ui/readable.js'
import {projectStages,stageProduct} from '../shared/production/production_stages.js'
import {createTaskHistory} from '@agent-modules/task/ui'
import {taskHistoryPresentation} from './ui/task-presentation.js'

// 对齐a_drama_detail.json的data顺序；文档草案不作为运行时配置读取。
const panelStages=Object.freeze([
 ['adaptation_plan','adaptation_plan','改编规划'],
 ['story_segments','story_segments','故事分段'],
 ['asset_preparation','asset_preparation','核心资产准备'],
 ['shot_design','shot_design','分镜'],
 ['clip_arrangement','clip_arrangement','分片编排'],
 ['reference_binding','reference_binding','图片素材引用'],
 ['video_prompt','video_prompt','视频提示词'],
 ['video_render','video_render','视频生成'],
 ['video_editing','editing','视频剪辑'],
 ['video_delivery','delivery','分集导出'],
].map(([key,id,title])=>({...projectStages.find(stage=>stage.id===id),key,title})))

const labels={empty:'未开始',partial:'未完成',draft:'待核对',confirmed:'已完成',rejected:'未通过'}
// 状态仅用于展示：有候选不等于完成，真实活动任务优先于历史终态。
function workflowStatus(node,stage,active,execution){
 if(active?.task?.node_type===stage)return {tone:'pending',label:'执行中',running:true}
 if(execution?.status==='failed')return {tone:'error',label:'执行失败'}
 if(node.status==='rejected'||execution?.status==='rejected')return {tone:'error',label:'未通过'}
 if(node.status==='confirmed')return {tone:'complete',label:stage==='asset_preparation'?'已通过':labels.confirmed}
 if(execution?.status==='cancelled')return {tone:'pending',label:'已停止'}
 return {tone:'pending',label:labels[node.status]||'未完成'}
}
export function createProjectDocumentView(root,{project:initial,executionStates:initialExecutions={},save,request,openTasks,remove,state={},sessionId}={}){
 let project=initial,alive=true,dialog=null,busy=false,recordView=null,active=null,poll=null,opinionPending=null,mediaControls=null,sourceControlsDispose=null
 const storyBodies=new Map()
 let executionStates=initialExecutions
 const errors=new Map()
 const isActiveConflict=cause=>cause.code==='PROJECT_ACTIVE'||['短剧已有执行任务','短剧任务正在执行'].includes(cause.message)
 const setError=(cause,stage=state.documentStage)=>errors.set(stage,{message:cause.message,activeConflict:isActiveConflict(cause)})
 const memoryPanel=createMemoryPanel(root,{request})
 state.documentStage=panelStages.find(stage=>stage.key===state.documentStage||stage.id===state.documentStage)?.id||(state.documentStage==='project'?'project':panelStages[0].id)
 const acceptProject=next=>{for(const key of Object.keys(next.node_states)){if(state.documentOpinions?.[key]===project.node_states[key]?.opinion)state.documentOpinions[key]=next.node_states[key].opinion}project=next}
 const button=(text,action,className='')=>{const b=element('button',text,className);b.type='button';b.onclick=action;b.disabled=!action;return b}
 const commit=async command=>{if(!save)throw new Error('保存接口不可用');const stage=command.stage||command.node_type||state.documentStage;busy=true;try{const result=await save(command);if(alive&&result?.basic_info)acceptProject(result);errors.delete(stage);return result}finally{busy=false}}
 const fileUrl=(ref,download=false,groupId)=>`/api/drama/production-file?${new URLSearchParams({session_id:sessionId||'',ref,...(download?{download:'1'}:{}),...(groupId?{group_id:groupId}:{})})}`
 const reload=async()=>{const data=await request('project');if(!alive)return;if(data.project)acceptProject(data.project);executionStates=data.execution_states||{};sessionId=data.session_id||sessionId;active=data.active_execution||null;if(!active)for(const [stage,cause]of errors)if(cause.activeConflict)errors.delete(stage);if(!dialog&&!root.querySelector('dialog[open]')&&!root.getRootNode().activeElement?.classList.contains('node-ui-opinion'))paint();return data}
 const follow=()=>{if(!alive||poll||!request)return;poll=setInterval(()=>{if(!alive||recordView||!active&&![...errors.values()].some(cause=>cause.activeConflict)&&!Object.values(project.node_states).some(n=>n.status==='partial'))return;void reload().catch(()=>{})},2000)}
 const run=async(stage,input={})=>{if(busy)return;await opinionPending;errors.delete(stage);busy=true;try{const node=project.node_states[stage],instruction=state.documentOpinions?.[stage]??node.opinion;const result=await request(`production/${stage}`,{method:'POST',headers:{'Content-Type':'application/json','X-Drama-Request':'1'},body:JSON.stringify({project_id:project.basic_info.id,request_id:crypto.randomUUID(),instruction,...(stage==='editing'&&!Object.hasOwn(input,'use_existing')?{use_existing:project.editing.timelines.length>0}:{}),...input})});state.activeGroup=result.group_id;errors.delete(stage);await reload();follow()}catch(cause){setError(cause,stage);if(isActiveConflict(cause)){await reload().catch(()=>{});follow()}}finally{busy=false;if(alive)paint()}}
 const resume=async(stage)=>{const groupId=executionStates[stage]?.group_id;if(!groupId)throw new Error('找不到可续接任务');await run(stage,{resume_of:groupId})}
 const close=()=>{if(dialog?.open)dialog.close();dialog?.remove();dialog=null}
 const editor=(title,value,makeCommand,{text=false,readOnly=false,inlineRefs=true}={})=>{
  close();dialog=element('dialog','','details-dialog production-editor');dialog.setAttribute('aria-label',title);const owned=dialog;owned.addEventListener('close',()=>{owned.remove();if(dialog===owned)dialog=null},{once:true})
  const heading=element('h3',title),input=element('textarea','','production-editor-input'),failure=element('p','','error'),footer=element('div','','node-ui-buttons')
  input.setAttribute('aria-label',title);input.value=text?value:JSON.stringify(value,null,2);input.spellcheck=false;input.readOnly=readOnly
  const saveButton=button('保存',async()=>{if(busy)return;failure.textContent='';saveButton.disabled=true;try{const next=text?input.value:JSON.parse(input.value);await commit(makeCommand(next));if(alive){close();paint()}}catch(cause){failure.textContent=cause.message}finally{saveButton.disabled=false}})
  footer.append(button(readOnly?'关闭':'取消',close));if(!readOnly)footer.append(saveButton);dialog.append(heading,...(!text&&!readOnly&&inlineRefs?[element('p','正文引用可填写 {"$text":"正文","$format":"txt"}，保存时程序会创建文件。','meta')]:[]),input,failure,footer);root.append(dialog);showPanelDialog(dialog)
 }
 const scriptLibrary=request?{listScripts:async()=> (await request('library')).assets,readScript:async id=>(await request(`library/scripts/${encodeURIComponent(id)}`)).body}:{}
 const editProjectInfo=()=>{
  close();const snapshot=structuredClone(project),revision=snapshot.node_states.project.product_revision
  const owned=projectDialog(root,async fields=>{await commit({kind:'basic_info',value:{...fields.basic_info,output_language:snapshot.basic_info.output_language},...(fields.source?{source:fields.source}:{}),expected_revision:revision});if(alive&&dialog===owned){owned.close();paint()}},{project:snapshot,maxScriptBytes:24*1024*1024,...scriptLibrary})
  dialog=owned;owned.addEventListener('close',()=>{if(dialog===owned)dialog=null},{once:true})
 }
 const fieldNames={social_role:'团队身份与职能',motivation:'人物动机',relationships:'人物关系',body:'正文',name:'名称',title:'标题',summary:'摘要',description:'描述',arc:'人物变化',function:'叙事作用',instruction:'改编指引',layout:'固定布局',entrances:'出入口',landmarks:'固定地标',hair_and_makeup:'发型与妆容',start:'原文起点（字符）',end:'原文终点（不含）',action:'动作',camera:'摄影',scene_changes:'场景变化',effects:'特效',text:'对白原文',emotion:'情绪',volume:'音量',pace:'语速',breath:'气息',soundscape:'环境声',music:'配乐',duration_seconds:'时长（秒）',in_seconds:'入点（秒）',out_seconds:'出点（秒）',position_seconds:'时间线位置（秒）',fade_seconds:'淡入淡出时长（秒）',width:'输出宽度',height:'输出高度',fps:'每秒帧数',subtitle_mode:'字幕模式',normalize_audio:'统一响度'}
 const openFields=(title,values,makeCommand,choices={})=>{
  close();dialog=element('dialog','','production-editor');dialog.setAttribute('aria-label',title);const owned=dialog;owned.addEventListener('close',()=>{owned.remove();if(dialog===owned)dialog=null},{once:true});const form=element('div','','production-field-form'),inputs={},failure=element('p','','error')
  dialog.append(element('h3',title))
  for(const [key,value]of Object.entries(values)){const label=element('label',fieldNames[key]||key),input=element(typeof value==='number'||typeof value==='boolean'?'input':choices[key]||key==='subtitle_mode'?'select':'textarea');input.setAttribute('aria-label',fieldNames[key]||key);if(typeof value==='number'){input.type='number';input.step='any'}if(typeof value==='boolean'){input.type='checkbox';input.checked=value}if(choices[key])for(const choice of choices[key]){const option=element('option',choice.label);option.value=choice.value;input.append(option)}if(key==='subtitle_mode'){for(const [v,t]of [['sidecar','外挂字幕SRT'],['burn','字幕烧入画面']]){const option=element('option',t);option.value=v;input.append(option)}}input.value=String(value);inputs[key]=input;label.append(input);form.append(label)}
  const footer=element('div','','node-ui-buttons');footer.append(button('取消',close),button('保存',async()=>{if(busy)return;try{const value=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,typeof values[key]==='number'?Number(input.value):typeof values[key]==='boolean'?input.checked:input.value]));await commit(makeCommand(value));close();paint()}catch(cause){failure.textContent=cause.message}}));dialog.append(form,failure,footer);root.append(dialog);showPanelDialog(dialog)
 }
 const replaceEntity=(product,id,fields)=>{const next=structuredClone(product);let found=false;const walk=value=>{if(!value||typeof value!=='object')return;if(value.id===id){Object.assign(value,fields);found=true;return}for(const item of Object.values(value))if(item&&typeof item==='object')walk(item)};walk(next);if(!found)throw new Error('编辑对象不存在');return next}
 const openFile=async(ref,stage,{readOnly=false,groupId}={})=>{
  try{
   const fetchPage=async start=>request(`production-file?${new URLSearchParams({ref,start:String(start),end:String(start+16000),...(groupId?{group_id:groupId}:{})})}`)
   const first=await fetchPage(0);let text=first.body;const length=first.characters
   if(length>240000){
    editor('完整记录文件（按页读取）',text,()=>({}),{text:true,readOnly:true});const owned=dialog,position=element('span',`0–${first.end} / ${length}`),bar=element('div','','node-ui-buttons');let offset=0
    const load=async value=>{try{offset=Math.max(0,Math.min(Math.floor((length-1)/16000)*16000,value));const page=await fetchPage(offset);if(dialog!==owned)return;owned.querySelector('textarea').value=page.body;position.textContent=`${offset}–${page.end} / ${length}`}catch(cause){position.textContent=cause.message}}
    bar.append(button('上一页',()=>load(offset-16000)),position,button('下一页',()=>load(offset+16000)));owned.append(bar)
   }else{for(let start=16000;start<length;start+=16000)text+=(await fetchPage(start)).body;editor('查看/编辑正文',text,value=>({kind:'artifact_text',stage,ref,value,expected_revision:project.node_states[stage].product_revision}),{text:true,readOnly})}
   const link=element('a','下载完整文件');link.href=fileUrl(ref,true,groupId);dialog.append(link)
  }catch(cause){setError(cause,stage);paint()}
 }
 const showStoryBody=(card,ref)=>{
  const body=element('p','正在加载正文…','production-text');card.append(body)
  const key=project.basic_info.id+':'+ref
  const load=async()=>{
   body.setAttribute('aria-busy','true')
   try{
    if(!storyBodies.has(key))storyBodies.set(key,(async()=>{
     const page=async start=>request(`production-file?${new URLSearchParams({ref,start:String(start),end:String(start+16000)})}`)
     const first=await page(0);let text=first.body
     for(let start=16000;start<first.characters;start+=16000)text+=(await page(start)).body
     return text
    })().catch(cause=>{storyBodies.delete(key);throw cause}))
    const text=await storyBodies.get(key)
    if(alive&&body.isConnected)body.textContent=text
   }catch{
    if(alive&&body.isConnected){body.textContent='正文加载失败，请重试。';body.append(button('重试加载正文',load))}
   }finally{body.setAttribute('aria-busy','false')}
  }
  void load()
 }
 function paint(){if(!alive||recordView)return;const error=errors.get(state.documentStage)?.message||'';mediaControls?.dispose();sourceControlsDispose?.();sourceControlsDispose=null;root.replaceChildren();root.classList.add('project-production','production-workspace')
  const statuses=new Map(projectStages.map(stage=>[stage.id,workflowStatus(project.node_states[stage.id],stage.id,active,executionStates[stage.id])])),completed=panelStages.filter(stage=>statuses.get(stage.id).tone==='complete').length
  const head=element('header','','production-project-header'),identity=element('div','','production-project-identity'),tools=element('nav','','production-project-tools')
  identity.append(element('h2',project.basic_info.name),element('span',`已完成 ${completed} / ${panelStages.length}`,'production-progress'));tools.setAttribute('aria-label','短剧记忆工具');if(request)tools.append(button('短剧记忆',()=>memoryPanel.open('project')),button('Drama通用偏好',()=>memoryPanel.open('engineering')));if(remove)tools.append(button('删除短剧',remove,'production-danger'));head.append(identity,tools);root.append(head)
  const layout=element('div','','production-layout'),workflow=element('aside','','production-workflow'),nav=element('nav','','production-step-nav stage-overview'),body=element('section','','production-step-content session-body'),workflowHead=element('div','','production-workflow-heading'),legend=element('div','','production-workflow-legend')
  workflowHead.append(element('h3','制作流程'),element('span',`${panelStages.length} 个步骤`));for(const [tone,text]of [['complete','完成'],['error','未通过 / 失败'],['pending','未完成']]){const item=element('span',text);item.dataset.tone=tone;legend.append(item)}workflow.append(workflowHead,legend,nav)
  nav.setAttribute('role','tablist');nav.setAttribute('aria-label','短剧制作步骤');nav.setAttribute('aria-orientation','vertical');body.setAttribute('role','tabpanel');body.id=`product-${project.basic_info.id}`
  for(const [index,stage]of panelStages.entries()){
   const status=statuses.get(stage.id),selected=stage.id===state.documentStage,b=button('',()=>{state.documentStage=stage.id;paint();root.querySelector('[aria-selected=true]')?.focus()},'stage')
   const marker=element('span','','production-step-marker'),copy=element('span','','production-step-copy');marker.setAttribute('aria-hidden','true');copy.append(element('span',`${index+1}. ${stage.title}`,'production-step-title'));if(status.tone==='error'||status.running||['待核对','已停止'].includes(status.label))copy.append(element('small',status.label,'production-step-status'));b.append(marker,copy);b.dataset.tone=status.tone;b.dataset.running=String(!!status.running);b.setAttribute('aria-label',`${index+1}. ${stage.title}，${status.label}`)
   b.id=`step-${stage.id}`;b.dataset.stage=stage.id;b.dataset.node=stage.key;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(selected));b.setAttribute('aria-controls',body.id);b.tabIndex=selected||!panelStages.some(row=>row.id===state.documentStage)&&index===0?0:-1
   b.onkeydown=event=>{const move={ArrowDown:1,ArrowUp:-1,ArrowRight:1,ArrowLeft:-1}[event.key];let target;if(move)target=(index+move+panelStages.length)%panelStages.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=panelStages.length-1;if(target===undefined)return;event.preventDefault();state.documentStage=panelStages[target].id;paint();root.querySelector('[aria-selected=true]')?.focus()}
   nav.append(b)
  }
  const resources=element('nav','','production-project-nav');resources.setAttribute('aria-label','剧本资料')
  for(const id of ['project']){
   const stage=projectStages.find(row=>row.id===id),status=statuses.get(id),selected=id===state.documentStage,b=button(stage.title,()=>{state.documentStage=id;paint();root.querySelector(`[data-stage=${id}]`)?.focus()},'production-project-link')
   b.id=`step-${id}`;b.dataset.stage=id;b.dataset.tone=status.tone;b.dataset.running=String(!!status.running);b.setAttribute('aria-label',`${stage.title}，${status.label}`);b.setAttribute('aria-pressed',String(selected));b.setAttribute('aria-controls',body.id);resources.append(b)
   if(status.tone==='error'||status.running||['待核对','已停止'].includes(status.label))b.append(element('small',status.label,'production-step-status'))
  }
  workflow.prepend(element('h4','剧本资料','production-project-nav-title'),resources)
  const stage=panelStages.find(row=>row.id===state.documentStage)||projectStages.find(row=>row.id===state.documentStage)||panelStages[0],node=project.node_states[stage.id],section=element('section','','production-section script-node'),title=element('div','','section-head')
  section.dataset.nodeType=stage.id;section.dataset.status=node.status;section.dataset.tone=statuses.get(stage.id).tone;title.append(element('h3',stage.title),element('span',statuses.get(stage.id).label,'node-data-tag'));section.append(title)
  const ui=element('div','','node-ui'),toolbar=element('div','','node-ui-buttons'),records=element('nav','','node-ui-records'),actions=element('div','','node-ui-execution')
  records.append(button('任务历史',request?()=>showHistory(stage):undefined))
  if(['ai','image','video'].includes(stage.kind)){records.append(button('查看规则',()=>{editor('当前完整动作规则',node.rules,()=>({}),{readOnly:true});const current=dialog;void request(`production-rules?stage=${stage.id}`).then(data=>{if(dialog===current&&data.bases)current.querySelector('textarea').value=JSON.stringify(data.bases,null,2)}).catch(()=>{})}),button('编辑补充规则',()=>editor('短剧动作补充规则（空值使用默认规则）',node.rules,value=>({kind:'rules',stage:stage.id,value,previousValue:node.rules}))))}
  const product=stageProduct(project,stage.id)
  if(stage.id!=='project')actions.append(button('人工编辑产物',()=>editor(`编辑${stage.title}`,stage.id==='source_analysis'?{chapters:product.chapters}:product,value=>({kind:'product',stage:stage.id,value:stage.id==='source_analysis'?{...product,chapters:value.chapters}:value,expected_revision:node.product_revision}),{inlineRefs:stage.id!=='source_analysis'})))
  if(stage.id==='project'){
   const info=element('div','','production-project-info'),summary=element('p',`${project.basic_info.creation_mode} · ${project.basic_info.aspect_ratio} · ${({ 'zh-CN':'简体中文','zh-TW':'繁体中文','en':'英语','ja':'日语'})[project.basic_info.output_language]||project.basic_info.output_language}`,'production-project-meta');info.append(summary,button('编辑短剧信息',editProjectInfo));section.append(info)
   const imports=element('div','','production-source-import');sourceControlsDispose=scriptImport(imports,{...scriptLibrary,maxScriptBytes:24*1024*1024,importScript:async(value,originalName)=>{await commit({kind:'import_script',value,originalName,expected_revision:node.product_revision});if(alive)paint()}});imports.querySelector('.workflow-generation-row').append(...records.childNodes);actions.append(imports)
  }
  if(stage.id!=='project'){if(stage.id!=='delivery')actions.prepend(button(stage.kind==='image'?'生成缺少的素材':stage.kind==='video'?'生成缺少的分片':stage.kind==='ai'?'生成/重新生成':'执行本步骤',()=>run(stage.id),'production-primary'));if(stage.id!=='asset_preparation')actions.append(button('人工检查确认',()=>commit({kind:'confirm_stage',stage:stage.id,expected_revision:node.product_revision}).then(paint).catch(cause=>{setError(cause,stage.id);paint()})));if(stage.kind==='ai'&&node.product_revision>0)actions.append(button('按意见修改现有产物',()=>run(stage.id,{revise:true})));if(executionStates[stage.id]&&['failed','cancelled','rejected'].includes(executionStates[stage.id].status))actions.append(button('从检查点继续',()=>resume(stage.id).catch(cause=>{setError(cause,stage.id);paint()})))}
  if(active?.group?.id&&active.task?.metadata.production)actions.append(button('停止当前任务',async()=>{await request(`production-tasks/${encodeURIComponent(active.group.id)}/cancel`,{method:'POST',headers:{'X-Drama-Request':'1'}});await reload()}))
  if(stage.id!=='project'){toolbar.append(records);ui.append(toolbar)}
  const opinion=element('input','','node-ui-opinion');opinion.placeholder='本次执行意见';opinion.setAttribute('aria-label',`${stage.title}本次执行意见`);state.documentOpinions||={};opinion.value=state.documentOpinions[stage.id]??node.opinion;opinion.oninput=()=>{state.documentOpinions[stage.id]=opinion.value}
  opinion.onblur=async()=>{if(!save||opinion.value===node.opinion||busy)return;try{opinionPending=commit({kind:'node_opinion',node_type:stage.id,value:opinion.value,previousValue:node.opinion});await opinionPending;paint()}catch(cause){setError(cause,stage.id);paint()}}
  if(stage.id!=='project')ui.append(opinion);ui.append(actions);section.append(ui)
  const running=statuses.get(stage.id).running&&!error,reason=node.reason==='任务已受理'?'':node.reason
  const notice=element('p',running?'':error||(statuses.get(stage.id).tone==='error'&&executionStates[stage.id]?.reason)||reason,`${error||statuses.get(stage.id).tone==='error'?'error':'meta'} node-ui-failure`);notice.setAttribute('role','status')
  if(running){const spinner=element('span','','original-summary-loading');spinner.setAttribute('aria-hidden','true');notice.setAttribute('aria-label','执行中');notice.setAttribute('aria-busy','true');notice.append(spinner)}
  notice.hidden=!running&&!notice.textContent;section.append(notice)
  const collectionTitles={locked_requirements:'改编约束',character_plans:'人物规划',scene_plans:'场景规划',group_plans:'团队规划',chapters:'章节',segments:'故事段'}
  const rows=Array.isArray(product)?product:Object.entries(product).filter(([key,value])=>Array.isArray(value)).flatMap(([key,value])=>value.length&&value.every(row=>typeof row==='string')?[{title:collectionTitles[key]||key,content:value,_collection:key,_textList:true}]:value.map(row=>({...row,_collection:key})))
  if(stage.id!=='source_analysis'&&!Array.isArray(product))for(const [key,ref]of Object.entries(product))if(key.endsWith('_ref')&&typeof ref==='string')rows.push({title:({coverage_ref:'覆盖报告'})[key]||key,[key]:ref})
  if(stage.id!=='shot_design'&&!rows.length&&!(stage.id==='adaptation_plan'&&product.plot_development.trim()))section.append(element('p',stage.id==='project'?'尚未导入原稿，请从本地或素材库导入。':`暂无${stage.title}产物；支持人工创建和编辑。`,stage.id==='project'?'production-source-empty':'production-empty'))
  const guidanceGroups=new Map()
  if(stage.id==='adaptation_plan'){
   for(const [key,title]of [['creative_constraints','全篇创作约束'],['plot_development','剧情发展'],['character_plans','人物规划'],['group_plans','团队规划'],['scene_plans','场景规划']]){
    const group=element('section','','role-module-card production-guidance-group'),cards=element('div','','production-guidance-cards');group.dataset.guidanceGroup=key;group.append(element('h3',title),cards);guidanceGroups.set(key,{group,cards})
   }
   const constraints=element('article','','production-card');constraints.append(element('p',readable(product.creative_constraints),'production-text'),button('编辑全篇创作约束',()=>editor('编辑全篇创作约束',product.creative_constraints,value=>({kind:'product',stage:stage.id,value:{...product,creative_constraints:value},expected_revision:node.product_revision}))));guidanceGroups.get('creative_constraints').cards.append(constraints)
   const plot=element('article','','production-card')
   plot.append(element('p',product.plot_development||'暂无剧情发展规划。','production-text'),button('编辑剧情发展',()=>editor('编辑剧情发展',product.plot_development,value=>({kind:'product',stage:stage.id,value:{...product,plot_development:value},expected_revision:node.product_revision}),{text:true})));guidanceGroups.get('plot_development').cards.append(plot)
  }
  if(stage.id==='project'&&rows.length)section.append(element('h4','原稿文件','production-source-heading'))
  for(const row of (['shot_design','asset_preparation','video_render','clip_arrangement','editing','delivery'].includes(stage.id)?[]:rows)){const card=element('article','',stage.id==='project'?'production-source-row':'production-card');if(row._collection==='group_plans')card.append(element('small','团队规划'));card.append(element('h4',stage.id==='project'?`${row.original_name||'原稿'}${row.id===project.source.current_revision_id?' · 当前原稿':''}`:row.title||row.name||row.id||collectionTitles[row._collection]||row._collection||'产物'),...(stage.id==='story_segments'?[]:[element('p',stage.id==='project'?`${row.character_count.toLocaleString()} 字符`:readable(row._textList?row.content:Object.fromEntries(Object.entries(row).filter(([key])=>key!=='_collection'&&!(stage.id==='source_analysis'&&key==='body')))),'production-text')]))
   if(stage.id==='story_segments')showStoryBody(card,row.body_ref)
   for(const [key,ref]of Object.entries(row))if(stage.id!=='project'&&key.endsWith('_ref')&&typeof ref==='string'&&/\.(txt|json|srt)$/.test(ref))card.append(button(stage.id==='story_segments'&&key==='continuity_ref'?'编辑衔接记录':'编辑正文',()=>openFile(ref,stage.id)))
   if(row.id&&stage.id!=='project'){
    const fields=Object.fromEntries(Object.entries(row).filter(([key,value])=>Object.hasOwn(fieldNames,key)&&(typeof value==='string'||typeof value==='number')))
    if(Object.keys(fields).length)card.append(button('编辑此项',()=>openFields(`编辑${row.title||row.name||stage.title}`,fields,value=>({kind:'product',stage:stage.id,value:replaceEntity(product,row.id,value),expected_revision:node.product_revision}))))
    if(stage.id==='source_analysis'&&typeof row.body==='string')card.append(button(`查看正文（${row.body.length.toLocaleString()} 字符）`,()=>editor(row.title+' · 原文',row.body,()=>({}),{text:true,readOnly:true})))

   }
   if(stage.id==='project'&&row.file_ref)card.append(button('分页查看原稿',()=>openFile(row.file_ref,'project',{readOnly:true})))
   const target=stage.id==='adaptation_plan'?guidanceGroups.get(row._collection)?.cards:section
   ;(target||section).append(card)
  }
  for(const [key,{group,cards}]of guidanceGroups){if(key==='group_plans'&&!cards.children.length){const empty=element('article','','production-card');empty.append(element('p','暂无团队规划。','meta'));cards.append(empty)}if(cards.children.length)section.append(group)}
  if(stage.id==='shot_design'){
   const shotCommand=(id,fields)=>({kind:'product',stage:stage.id,value:replaceEntity(product,id,fields),expected_revision:node.product_revision})
   const characterKey=(row,index)=>`人物 ${index+1}（${project.asset_library.characters.find(c=>c.id===row.character_id).name}）开场状态`
   const propKey=(row,index)=>`道具 ${index+1}（${project.asset_library.props.find(p=>p.id===row.prop_id).name}）开场状态`
   renderShotList(section,project,{
    editShot:shot=>openFields(`编辑镜头 ${shot.sequence}`,{场景:shot.scene_id||'',...Object.fromEntries(shot.characters.map((row,index)=>[characterKey(row,index),row.opening_state])),...Object.fromEntries(shot.props.map((row,index)=>[propKey(row,index),row.opening_state]))},value=>shotCommand(shot.id,{scene_id:value.场景||null,characters:shot.characters.map((row,index)=>({...row,opening_state:value[characterKey(row,index)]})),props:shot.props.map((row,index)=>({...row,opening_state:value[propKey(row,index)]}))}),{场景:[{value:'',label:'未指定场景'},...project.asset_library.scenes.map(scene=>({value:scene.id,label:scene.name}))]}),
    editBeat:(shot,beat)=>openFields(`编辑镜头 ${shot.sequence} 节拍`,{duration_seconds:beat.duration_seconds,action:beat.action,camera:beat.camera,scene_changes:beat.scene_changes,effects:beat.effects,soundscape:beat.soundscape,music:beat.music},value=>shotCommand(beat.id,value)),
    editDialogue:(shot,line)=>openFields(`编辑镜头 ${shot.sequence} 对白`,{text:line.text,...line.delivery},value=>{const {text,...delivery}=value;return shotCommand(line.id,{text,delivery})})
   })
  }
  mediaControls=productionControls({root,section,project,stage:stage.id,command:async command=>{await commit(command);paint()},request,run,openEditor:editor,openFields,openFile,fileUrl,active})
  body.setAttribute('aria-labelledby',`step-${stage.id}`);body.append(section);layout.append(workflow,body);root.append(layout)
 }
 function showHistory(stage){
  close();const files=element('section','','production-record-files');const detail=async id=>{const data=(await request(`task-history?${new URLSearchParams({project_id:project.basic_info.id,node_type:stage.id,id})}`)).detail;const refs=new Set(),collect=value=>{if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(key.endsWith('_ref')&&typeof item==='string')refs.add(item);else if(item&&typeof item==='object')collect(item)}};collect(data);files.replaceChildren(element('h3','完整输入、提示词、候选与工具记录'));for(const ref of refs)files.append(button(ref,()=>openFile(ref,stage.id,{readOnly:true,groupId:id})));return data};const query=new URLSearchParams({project_id:project.basic_info.id,node_type:stage.id});recordView=createTaskHistory({document:root.ownerDocument,presentation:taskHistoryPresentation,title:`${stage.title} · 任务记录`,nodeTypes:[{type:stage.id,label:stage.title}],initialView:{node_type:stage.id},onBack:()=>{recordView.dispose();recordView=null;paint()},source:{history:filter=>request(`task-history?${new URLSearchParams({...filter,project_id:project.basic_info.id,node_type:stage.id})}`),detail}});root.replaceChildren(recordView.element,files)
 }
 paint();if(request&&sessionId){void reload().catch(()=>{});follow();}return {update(next,{executionStates:nextExecutions=executionStates}={}){if(!alive)return;acceptProject(next);executionStates=nextExecutions;if(!dialog&&!root.querySelector('dialog[open]')&&!root.getRootNode().activeElement?.classList.contains('node-ui-opinion'))paint()},dispose(){alive=false;memoryPanel.dispose();clearInterval(poll);mediaControls?.dispose();sourceControlsDispose?.();close();recordView?.dispose();root.classList.remove('production-workspace','project-production')},get isShowingRecords(){return !!recordView}}
}
