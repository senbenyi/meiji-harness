import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {requestIdentity} from '../project_runtime/request-identity.js'
import {createWriteQueue} from '../project_runtime/write_queue.js'
import {memoryDomain} from './service.js'
const plain=content=>typeof content==='string'?content:Array.isArray(content)?content.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n'):''
const same=(a,b)=>a.role===b.role&&a.text===b.text

/** 只记录已绑定Drama会话的可见用户/助手文字；不采集系统、工具和推理。 */
export class MemoryConversations {
  constructor(projects){this.projects=projects;this.queue=createWriteQueue()}
  async location(context){const p=await this.projects.context(context.sessionId,context.projectId);return {project:p,path:join(this.projects.documents.directory(p.basic_info.id),'memory-conversations',requestIdentity(['memory-dialogue',context.sessionId])+'.json')}}
  async read(context){const {path}=await this.location(context);try{return JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code==='ENOENT')return {domain:memoryDomain,session_id:context.sessionId,messages:[],processed:[]};throw e}}
  async append(context,messages){
    await this.location(context)
    return this.queue.run(async()=>{
      const data=await this.read(context),incoming=messages.filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,text:plain(m.text??m.content),native_id:typeof m.id==='string'?m.id:null})).filter(m=>m.text.trim())
      const hasNative=incoming.length&&incoming.every(m=>m.native_id),fresh=[]
      if(hasNative){for(const m of incoming)if(!data.messages.some(old=>old.native_id===m.native_id&&same(old,m)))fresh.push(m)}
      else{let overlap=0;for(let i=0;i<data.messages.length;i++){let count=0;while(count<incoming.length&&i+count<data.messages.length&&same(data.messages[i+count],incoming[count]))count++;if(count===incoming.length||i+count===data.messages.length)overlap=Math.max(overlap,count)}fresh.push(...incoming.slice(overlap))}
      for(const message of fresh)data.messages.push({...message,id:`turn_${randomUUID()}`,at:new Date().toISOString()})
      if(Buffer.byteLength(JSON.stringify(data))>24*1024*1024)throw new TypeError('该会话记忆原文超过24MiB，请拆分会话；未截断原文')
      if(fresh.length)await this.projects.memories.save((await this.location(context)).path,data)
      return {added:fresh.length,pending:data.messages.filter(m=>!data.processed.includes(m.id)),messages:data.messages}
    })
  }
  async pending(context){const data=await this.read(context);return data.messages.filter(m=>!data.processed.includes(m.id))}
  async processed(context,ids){return this.queue.run(async()=>{const data=await this.read(context);data.processed=[...new Set([...data.processed,...ids])];await this.projects.memories.save((await this.location(context)).path,data)})}
  async dispose(){await this.queue.run(async()=>{})}
}
export function conversationUnits(messages){
  const pages=[]
  for(let i=0;i<messages.length;i++){
    const message=messages[i];if(message.role!=='user')continue
    for(let start=0;start<message.text.length;start+=6000){let end=Math.min(start+6000,message.text.length);if(end<message.text.length&&/[\uD800-\uDBFF]/.test(message.text[end-1]))end--;const next=end===start?start+2:end;pages.push({id:`input_${pages.length}`,role:'user',turn_id:message.id,start,end:next,text:message.text.slice(start,next),background:messages.slice(Math.max(0,i-2),i).filter(m=>m.role==='assistant').map(m=>m.text.slice(-1600))});if(next<start+6000)start=next-6000}
  }
  return pages
}
