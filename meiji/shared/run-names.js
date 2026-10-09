// 面板、预览和会话观察共用的业务名称；内部kind/target保持不变。
export const stepKindLabels = { execute:'执行',save:'保存',generate:'生成',review:'自审',revise:'修订',re_review:'复审',check:'校验',override:'人工放行',manual_edit:'人工编辑',
 image:'生成图片',wait_confirm:'等待图片确认',wait_script_confirm:'等待剧本确认',storyboard:'编排分镜提示词',video:'生成视频',tail:'提取尾帧',sync:'回写剧本',expand:'安排后续步骤',
 video_submit:'提交视频',video_generate:'获取生成视频',image_generate:'调用图片服务',image_download:'下载图片并转Base64',image_base64:'转换图片Base64',image_save:'保存候选图片',tail_frame:'提取尾帧',assemble:'拼接成片',confirm:'处理候选图片',checkpoint:'人工关卡' }
const targets={ 'project-characters':'剧本重要角色','project-summary':'项目摘要',summary:'展示摘要',story:'剧情',outline:'剧情大纲',characters:'人物资料',scenes:'场景资料',props:'道具资料',shots:'镜头表',seconds:'每秒指令',storyboard:'分镜提示词',film:'视频',assembly:'成片拼接',image:'图片',images:'图片步骤',script:'剧本' }
export function targetLabel(target){
 if(!target)return '本任务'
 if(['images:characters','images:film-characters'].includes(target))return '人物图片步骤'
 if(target==='images:scenes')return '场景图片步骤'
 const [kind,...ids]=String(target).split(':')
 return [targets[kind]||'任务对象',...ids].join(' · ')
}
export function stepLabel(step={}){
 if(step.kind==='generate' && step.target==='summary')return '提取展示摘要'
 const base=stepKindLabels[step.kind]||'未识别步骤'
 if(step.kind==='expand')return `安排${targetLabel(step.target)}`
 if(!step.target)return base
 if(step.kind==='storyboard')return `编排${targetLabel(step.target)}`
 if(['video','tail','assemble','sync'].includes(step.kind))return `${base}${step.target.includes(':')?' · '+step.target.split(':').slice(1).join(' · '):''}`
 if(step.kind==='image'){
  const kind=step.input?.taskType||step.input?.operation?.action||''
  const product=kind.includes('character')?'人物图片':kind.includes('scene')?'场景图片':kind.includes('prop')?'道具图片':'图片'
  return `生成${product} · ${step.input?.operation?.itemName||step.target.split(':').slice(1).join(' · ')}`
 }
 return `${base}${targetLabel(step.target)}`
}
export function goalProductLabel(goal={}){
 if(goal.to==='film')return ({storyboard:'分镜提示词',video:'视频',tail:'尾帧'})[goal.parts]||'成片（提示词→视频→尾帧）'
 if(goal.to==='images'){
  const id=goal.scope?.itemIds?.[0]||''
  const kind=goal.scope?.library?.kind||goal.scope?.kinds?.[0]||(/^[CR]/.test(id)?'characters':/^[EL]/.test(id)?'scenes':/^[PT]/.test(id)?'props':'')
  return ({characters:'人物图片',scenes:'场景图片',props:'道具图片'})[kind]||'图片'
 }
 if(goal.to==='story')return ({outline:'剧情大纲',characters:'人物资料',scenes:'场景资料',props:'道具资料'})[goal.scope?.only]||'剧情大纲'
 return ({summary:'展示摘要','project-characters':'剧本重要角色','project-summary':'项目摘要',shots:'镜头表','shot-table':'镜头表',seconds:'每秒指令',images:'图片',assemble:'成片','script-sync':'剧本','script-revise':'剧本修改方案'})[goal.to]||'制作任务'
}
export function goalActionLabel(goal={}){
 if(goal.mode==='review')return '审核'
 if(goal.mode==='modify')return '修改'
 const again=goal.mode==='regenerate'
 if(goal.to==='film'&&goal.parts==='storyboard')return again?'重新编排':'编排'
 if(goal.to==='film'&&goal.parts==='tail')return again?'重新提取':'提取'
 if(goal.to==='film'&&!goal.parts)return again?'重新制作':'制作'
 if(goal.to==='assemble')return '拼接'
 if(goal.to==='script-sync')return '回写'
 return again?'重新生成':'生成'
}
export const isProgramStoryboard = step => step?.kind==='storyboard'
export const promptRecordLabel = step => isProgramStoryboard(step)?'查看编排结果':'查看模型输入'
export const verdictLabel = (step,passed) => `${isProgramStoryboard(step)?'校验':'审核'}${passed?'通过':'未通过'}`
