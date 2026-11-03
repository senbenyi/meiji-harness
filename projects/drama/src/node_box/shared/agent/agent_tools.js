import {chapterRanges,readChapterText} from '../../../shared/text/source.js'
import {searchMemory,modelMemoryEntry} from '../../../memory/service.js'
import {validateReview,parseCandidate} from './contracts.js'

const str={type:'string'},integer={type:'integer',minimum:0}
const define=(description,properties,execute,required=Object.keys(properties))=>({description,properties,required,execute})
function pointer(value,path=''){
  if(!path)return value
  if(typeof path!=='string'||!path.startsWith('/'))throw new TypeError('需使用JSON Pointer')
  for(const part of path.slice(1).split('/')){
    if(/~(?![01])/.test(part))throw new TypeError('Pointer转义无效')
    const key=part.replaceAll('~1','/').replaceAll('~0','~')
    if(!value||!Object.hasOwn(value,key))throw new TypeError('资料路径不存在')
    value=value[key]
  }
  return value
}
function bounded(value){if(JSON.stringify(value).length>16000)throw new TypeError(`资料过长（${Array.isArray(value)?'数组长度'+value.length:'对象'}），请按Pointer/范围分页读取，单次最多16000字符`);return value}
const covered=(ranges,start,end)=>{let cursor=start;for(const r of [...ranges].sort((a,b)=>a.start-b.start)){if(r.start>cursor)return false;cursor=Math.max(cursor,r.end)}return cursor>=end}

/** 每个工具在同一注册项声明模型接口与执行函数；只读取任务冻结资料。 */
export function createAgentTools({ctx,projects,unit,unitRef,snapshot,snapshotRef,stage,action,candidateRef,requireSourceCoverage,validate,context}){
  const {projectId,traces,candidateText,longMemory,unitMaterialIncluded}=context
  const state={memory:context.memory,unitRead:unitMaterialIncluded||traces.some(t=>t.unit_read),candidateRead:traces.at(-1)?.candidate_read||false,
    memoryReadIds:new Set(traces.flatMap(t=>t.memory_read_ids||[])),candidateRanges:traces.at(-1)?.candidate_ranges||[],sourceRanges:traces.at(-1)?.source_ranges||[],fileRanges:traces.at(-1)?.file_ranges||[],unitPaths:traces.at(-1)?.unit_paths||[]}
  const leafPaths=(value,path='')=>value&&typeof value==='object'&&Object.keys(value).length?Object.entries(value).flatMap(([key,item])=>leafPaths(item,`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`)):[path]
  const unitLeaves=leafPaths(unit.material||{})
  const recordUnitRead=(path='')=>{
    state.unitPaths.push(...unitLeaves.filter(leaf=>leaf===path||leaf.startsWith(path+'/')))
    state.unitRead=unitLeaves.every(leaf=>state.unitPaths.includes(leaf))
  }
  const sourceSpans=chapterRanges(snapshot.source_analysis.chapters,snapshot.source_analysis.source_revision_id)
  const recordSnapshotRead=(path='')=>{
    for(const [i,span]of sourceSpans.entries()){
      const bodyPath=`/source_analysis/chapters/${i}/body`
      if(path===bodyPath||bodyPath.startsWith(path+'/'))state.sourceRanges.push(span)
    }
  }
  const recordSourceFile=(ref,start,end)=>{
    for(const source of snapshot.source.revisions.filter(s=>s.file_ref===ref))state.sourceRanges.push({source_revision_id:source.id,start,end})
  }
  const recordCandidateRead=(start,end)=>{
    state.candidateRanges.push({start,end})
    state.candidateRead=covered(state.candidateRanges,0,candidateText.length)
  }
  const recordFileRead=(ref,start,end)=>{
    state.fileRanges.push({ref,start,end});recordSourceFile(ref,start,end)
    if(ref===candidateRef)recordCandidateRead(start,end)
  }
  const readableRefs=new Set([snapshotRef||ctx.task.metadata.snapshot_ref,unitRef,candidateRef,...(unit.read_refs||[]),...ctx.previousResults.flatMap(row=>[row.result?.trace?.file_ref,row.result?.candidate_ref,row.result?.accepted_ref])].filter(Boolean))
  const refs=value=>{if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(key.endsWith('_ref')&&typeof item==='string')readableRefs.add(item);else if(item&&typeof item==='object')refs(item)}}
  refs(snapshot)
  for(const trace of traces)for(const message of trace.messages)if(message.role==='tool')try{const result=JSON.parse(message.content);refs(result);if(result.body)refs(JSON.parse(result.body))}catch{}
  const submit=action==='review'?'submit_review':'submit_candidate'
  let accepted=null
  const registry={
    search_memory:define('检索任务适用的创作记忆索引',{query:str,offset:integer},args=>searchMemory(longMemory,args),[]),
    read_memory:define('读取一条适用用户记忆及来源',{id:str},args=>{
      const entry=longMemory.entries.find(e=>e.id===args.id)
      if(!entry)throw new TypeError('记忆不属于当前任务适用范围')
      state.memoryReadIds.add(entry.id);return modelMemoryEntry(entry)
    }),
    ...(!unitMaterialIncluded?{read_unit:define('按Pointer读取未附带的长单元资料',{pointer:str},args=>{const result=bounded(pointer(unit.material||{},args.pointer));recordUnitRead(args.pointer);return result},[])}:{}),
    read_context:define('按Pointer读取任务短剧快照',{pointer:str},args=>{
      const result=bounded(pointer(snapshot,args.pointer));recordSnapshotRead(args.pointer);return result
    },[]),
    search_context:define('检索快照中的文本并返回有限片段与Pointer',{pointer:str,query:str},args=>{
      const target=pointer(snapshot,args.pointer),query=args.query
      if(typeof query!=='string'||!query.trim()||query.length>200)throw new TypeError('检索词需1～200字符')
      const rows=Object.entries(target||{}).filter(([,value])=>JSON.stringify(value).includes(query))
      return {total:rows.length,items:rows.slice(0,12).map(([key,value])=>({pointer:`${args.pointer||''}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,excerpt:JSON.stringify(value).slice(0,900)}))}
    }),
    search_source:define('检索原著，返回最多20个上下文片段',{query:str,start:integer},async args=>{
      if(typeof args.query!=='string'||!args.query||args.query.length>200)throw new TypeError('检索词需1～200字符')
      const matches=[]
      for(const span of unit.source_spans||[]){
        const source=snapshot.source.revisions.find(s=>s.id===span.source_revision_id),text=(await projects.documents.readArtifact(projectId,source.file_ref)).toString()
        let index=Math.max(span.start,args.start||0)
        while((index=text.indexOf(args.query,index))>=0&&index<span.end&&matches.length<20){matches.push({source_revision_id:source.id,start:index,end:index+args.query.length,excerpt:text.slice(Math.max(span.start,index-60),Math.min(span.end,index+args.query.length+100))});index+=args.query.length}
      }
      return {matches}
    },['query']),
    read_file_json:define('按JSON Pointer读取任务JSON文件',{ref:str,pointer:str},async args=>{
      if(!readableRefs.has(args.ref))throw new TypeError('文件不属于本任务')
      const text=(await projects.documents.readArtifact(projectId,args.ref)).toString(),value=JSON.parse(text),result=bounded(pointer(value,args.pointer))
      refs(result)
      if(args.ref===(snapshotRef||ctx.task.metadata.snapshot_ref))recordSnapshotRead(args.pointer)
      if(args.ref===unitRef){if(!args.pointer||args.pointer==='/material')recordUnitRead();else if(args.pointer.startsWith('/material/'))recordUnitRead(args.pointer.slice(9))}
      if(!args.pointer){recordFileRead(args.ref,0,text.length)}
      return result
    },['ref']),
    remember:define('保存带来源引用的已读事实和未决问题',{note:str},args=>{
      if(typeof args.note!=='string'||args.note.length>6000)throw new TypeError('阶段记忆最多6000字符')
      state.memory=args.note;return {saved:true}
    }),
    read_source:define('读取当前单元原稿范围，每次最多16000字符',{start:integer,end:integer},async args=>{
      const span=(unit.source_spans||[]).find(s=>args.start>=s.start&&args.end<=s.end)
      if(!span)throw new TypeError('范围不属于本单元来源')
      const source=snapshot.source.revisions.find(s=>s.id===span.source_revision_id)
      const chapters=snapshot.source_analysis.source_revision_id===source.id?snapshot.source_analysis.chapters:[]
      const body=chapters.length?readChapterText(chapters,args.start,args.end):(await projects.documents.readArtifact(projectId,source.file_ref,{start:args.start,end:args.end})).toString()
      state.sourceRanges.push({source_revision_id:source.id,start:args.start,end:args.start+body.length});return {body}
    }),
    read_file:define('读取任务文本文件片段，每次最多16000字符',{ref:str,start:integer,end:integer},async args=>{
      if(!/\.(txt|json|srt)$/.test(args.ref||''))throw new TypeError('文本读取工具不能读取媒体文件')
      if(!readableRefs.has(args.ref))throw new TypeError('文件不属于本任务资料/记录')
      const start=args.start??0,body=(await projects.documents.readArtifact(projectId,args.ref,{start,end:args.end??16000})).toString(),end=start+body.length
      recordFileRead(args.ref,start,end)
      if(args.ref===unitRef&&covered(state.fileRanges.filter(r=>r.ref===unitRef),0,(await projects.documents.readArtifact(projectId,unitRef)).toString().length))recordUnitRead()
      let value
      try{value=JSON.parse(body)}catch{}
      if(value){
        refs(value)
        if(start===0&&args.ref===(snapshotRef||ctx.task.metadata.snapshot_ref)&&(await projects.documents.readArtifact(projectId,args.ref)).toString()===body)recordSnapshotRead()
      }
      return {body}
    }),
    read_candidate:define('分页读取当前候选JSON',{start:integer,end:integer},args=>{
      if(!candidateRef)throw new TypeError('本阶段没有候选')
      const start=args.start??0,end=args.end??Math.min(candidateText.length,16000)
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||end-start>16000)throw new TypeError('候选分页范围无效')
      recordCandidateRead(start,Math.min(end,candidateText.length))
      return {body:candidateText.slice(start,end),characters:candidateText.length,start,end:Math.min(end,candidateText.length)}
    },[]),
    [submit]:define('单独提交当前动作结果',{output:{type:'object'}},async(args,calls)=>{
      if(calls.length!==1)throw new TypeError('提交必须是当前动作唯一调用')
      if(!state.unitRead||action!=='generate'&&!state.candidateRead)throw new TypeError('提交前须读取完整单元资料以及最新候选')
      if(requireSourceCoverage&&(unit.source_spans||[]).some(span=>!covered(state.sourceRanges.filter(r=>r.source_revision_id===span.source_revision_id),span.start,span.end)))throw new TypeError('提交前必须读完当前分段正文')
      for(const ref of unit.read_refs||[]){const length=(await projects.documents.readArtifact(projectId,ref)).toString().length;if(!covered(state.fileRanges.filter(r=>r.ref===ref),0,length))throw new TypeError('提交前必须读完本单元正文：'+ref)}
      const value=action==='review'?validateReview(args.output):parseCandidate(stage,unit,args.output)
      if(action==='review'){
        const candidate=JSON.parse(candidateText),haystack=JSON.stringify(candidate)
        for(const issue of value.issues)if(!haystack.includes(JSON.stringify(issue.evidence).slice(1,-1))&&!JSON.stringify(unit.material).includes(JSON.stringify(issue.evidence).slice(1,-1))&&!longMemory.entries.filter(e=>state.memoryReadIds.has(e.id)).some(e=>e.content.includes(issue.evidence)))throw new TypeError('审核证据不是当前候选/单元中的实际原文')
      }else await validate(value)
      accepted=value;return {accepted:true}
    })
  }
  const tools=Object.entries(registry).map(([name,{description,properties,required}])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}}))
  async function execute(assistant){
    const delta=[assistant];let validationError=null,delivered=0
    for(const call of assistant.tool_calls||[]){
      ctx.signal.throwIfAborted()
      let result
      const before=structuredClone(state),beforeRefs=new Set(readableRefs)
      try{
        const args=JSON.parse(call.function.arguments||'{}')
        if(!args||Array.isArray(args)||typeof args!=='object')throw new TypeError('工具参数无效')
        const entry=registry[call.function.name]
        if(!entry)throw new TypeError('未知工具：'+call.function.name)
        result=await entry.execute(args,assistant.tool_calls)
        if(JSON.stringify(result).length+delivered>32000)throw Object.assign(new TypeError('单轮读取预算32000字符已用尽，请下轮继续'),{code:'READ_BUDGET'})
      }catch(error){
        if(!(error instanceof TypeError)&&!(error instanceof SyntaxError))throw error
        Object.assign(state,before);readableRefs.clear();beforeRefs.forEach(ref=>readableRefs.add(ref))
        if(call.function.name===submit){accepted=null;validationError=error.message}
        result={error:error.message}
      }
      delivered+=JSON.stringify(result).length
      delta.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)})
    }
    if(!assistant.tool_calls?.length)delta.push({role:'user',content:'请按需调用读取工具，再通过submit工具提交结果；直接文本不会写入短剧。'})
    return {output:accepted,validationError,delta,trace:{memory:state.memory,memory_read_ids:[...state.memoryReadIds],unit_read:state.unitRead,unit_paths:state.unitPaths,candidate_read:state.candidateRead,candidate_ranges:state.candidateRanges,source_ranges:state.sourceRanges,file_ranges:state.fileRanges}}
  }
  return {tools,execute}
}
