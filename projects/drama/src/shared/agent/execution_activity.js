// 当轮可见工具操作的只读展示，不使用模型推理文本或当前短剧补造历史。
const phases={prepare:'准备执行',generate:'生成内容',review:'独立审核',revise:'按问题修订',finish:'保存并结束',execute:'执行程序步骤',create:'创建短剧',manual_edit:'保存人工编辑'}
const actions={generate:'生成',review:'审核',revise:'修订'}
const trim=(value,limit=240)=>typeof value==='string'?value.slice(0,limit):''
const fieldNames={'/adaptation_plan':'全篇改编指导','/source_analysis':'原著解析','/asset_library':'素材索引','/story_segments':'故事定稿','/shot_design':'文字分镜'}
const location=args=>fieldNames[args.pointer]||trim(args.pointer,100)
const range=args=>Number.isSafeInteger(args.start)&&Number.isSafeInteger(args.end)&&args.end>args.start?`第 ${args.start+1}–${args.end} 字符`:''
export function executionPhase(kind){return phases[kind]||kind||'执行步骤'}
export function executionActivities(trace){
 const messages=Array.isArray(trace?.messages)?trace.messages:[],results=new Map(messages.filter(m=>m.role==='tool').map(m=>[m.tool_call_id,m]))
 const calls=messages.filter(m=>m.role==='assistant').flatMap(m=>m.tool_calls||[]),rows=[]
 for(const call of calls.slice(0,32)){
  const name=call.function?.name||'unknown';let args={},result={},readable=true
  try{args=JSON.parse(call.function?.arguments||'{}');if(!args||typeof args!=='object')args={}}catch{}
  const response=results.get(call.id)
  try{result=response?JSON.parse(response.content):{};if(!result||typeof result!=='object')result={}}catch{readable=false}
  const titles={read_skill:`读取${actions[trace.action]||'当前动作'}规则`,read_contract:'查看输出字段要求',read_unit:'查看本次任务资料',read_context:'读取短剧快照',search_context:'检索短剧资料',search_source:'检索原著',read_source:'读取原著',read_file:'读取资料文件',read_file_json:'按字段读取资料',read_candidate:'检查最新候选',search_memory:'检索创作记忆',read_memory:'读取创作记忆',remember:'整理本轮已读资料',submit_candidate:'提交候选产物',submit_review:'提交审核结论'}
  let title=titles[name]||`调用工具：${trim(name,80)}`,detail=''
  if(['read_source','read_candidate','read_file'].includes(name))detail=range(args)
  if(['read_context','search_context','read_unit','read_file_json'].includes(name))detail=location(args)
  if(['search_source','search_context','search_memory'].includes(name))detail=[detail,args.query?`检索“${trim(args.query,60)}”`:''].filter(Boolean).join(' · ')
  if(name==='read_file'&&typeof result.body==='string')try{const body=JSON.parse(result.body);if(body?.plot_development&&Array.isArray(body.character_plans))title='读取全篇改编指导'}catch{}
  const status=!response?'pending':!readable||result.error?'failed':['submit_candidate','submit_review'].includes(name)&&result.accepted!==true?'pending':'done'
  if(status==='pending')detail=response?'提交尚未得到确认':'尚无工具返回记录'
  else if(status==='failed')detail=trim(result.error)||'工具返回无法解析，请查看原始记录'
  else if(name==='submit_candidate')detail=result.accepted?'候选校验通过':''
  else if(name==='submit_review')detail=result.accepted?args.output?.status==='passed'?'审核通过':`发现 ${Array.isArray(args.output?.issues)?args.output.issues.length:0} 项问题`:''
  else if(name==='remember')detail=result.saved?'已保存本轮资料摘要':''
  rows.push({tool:trim(name,100),title,detail,status})
 }
 if(calls.length>32)rows.push({tool:'more',title:`另有 ${calls.length-32} 项工具调用`,detail:'完整内容见原始记录',status:'pending'})
 return rows
}
export function stepExecutionName(step,task){return task?.metadata?.document_version===4?executionPhase(step.kind):step.name}
