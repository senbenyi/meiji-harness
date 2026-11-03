import {executionActivities} from '../../../shared/agent/execution_activity.js'
import {modelClient} from '@agent-modules/http-client'
import {buildAgentContext} from './agent_context.js'
import {createAgentTools} from './agent_tools.js'

/** 一次Step请求模型并执行工具，保存真实消息；业务阶段推进交给text_executor。 */
export async function modelTurn({ctx,projects,models,unit,unitRef,snapshot,snapshotRef,stage,action,candidateRef,issues=[],requireSourceCoverage=false,validate,client=modelClient}){
  ctx.signal.throwIfAborted()
  const input={ctx,projects,unit,unitRef,snapshot,snapshotRef,stage,action,candidateRef,issues,requireSourceCoverage,validate}
  const context=await buildAgentContext(input),{projectId,phase,traces,messages}=context
  const tools=createAgentTools({...input,context})
  const promptRef=await projects.documents.writeArtifact(projectId,JSON.stringify(messages),{extension:'json'})
  const config=await models.read()
  ctx.recordPrompt({model:config.text.model,messages:[{role:'user',content:JSON.stringify({messages_ref:promptRef})}],input:{unit_ref:unitRef,snapshot_ref:snapshotRef||ctx.task.metadata.snapshot_ref,messages_ref:promptRef,action,stage}})
  const record=async(transfer,options)=>{
    transfer.title=`${stage} · ${action}`
    try{transfer.id=ctx.recordHttp(transfer,options)||transfer.id}catch(error){if(error.code!=='STEP_CLOSED')throw error}
    await projects.records.http.record(transfer,options)
  }
  const assistant=await client.turn({baseUrl:config.baseUrl,apiKey:config.apiKey,model:config.text.model,messages,tools:tools.tools,toolChoice:'auto',signal:ctx.signal,requestId:ctx.step.id,record})
  ctx.signal.throwIfAborted()
  if(JSON.stringify(assistant).length>160000)throw Object.assign(new TypeError('模型单轮输出超过160000字符，请减少单次定稿段数或缩小原著阅读范围后重试'),{code:'MODEL_OUTPUT_LIMIT'})
  const {output,validationError,delta,trace:state}=await tools.execute(assistant)
  const trace={phase,action,...state,messages:delta,validation_error:validationError}
  const traceRef=await projects.documents.writeArtifact(projectId,JSON.stringify(trace),{extension:'json'})
  if(validationError&&traces.filter(t=>t.validation_error).length>=2)throw Object.assign(new TypeError(`输出/工具修复次数已用尽：${validationError}`),{code:'INVALID_MODEL_OUTPUT'})
  return {output,trace:{phase,file_ref:traceRef,activities:executionActivities(trace)},pending:!output}
}
