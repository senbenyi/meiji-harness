import {randomUUID} from 'node:crypto'
import {projectStages} from '../shared/production_stages.js'
const kinds=['decision','constraint','preference','open_question']
const text=(value,name,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new TypeError(`${name}需1～${max}字符`);return value.trim()}
export function applyMemoryChange(data,scope,command,context){
      const action=command.action||'upsert';if(!['upsert','archive','restore','delete'].includes(action))throw new TypeError('未知记忆操作')
      const quote=text(command.user_quote,'用户原话或人工操作来源',2000),at=new Date().toISOString(),revision=data.revision+1
      let old=command.id?data.entries.find(e=>e.id===command.id):data.entries.find(e=>e.key===command.key),entry
      if(command.id&&!old||action!=='upsert'&&!old)throw Object.assign(new Error('记忆不存在'),{code:'ENOENT'})
      if(action==='upsert'){
        const key=text(command.key,'稳定主题key',80),title=text(command.title,'标题',100),content=text(command.content,'记忆正文',2000),kind=command.kind||'preference',stages=command.stages??[]
        if(!kinds.includes(kind)||scope==='engineering'&&kind!=='preference')throw new TypeError('工程记忆仅保存用户偏好；项目可保存决定/约束/偏好/未决问题')
        if(!Array.isArray(stages)||new Set(stages).size!==stages.length||stages.some(id=>!projectStages.some(s=>s.id===id)))throw new TypeError('记忆适用步骤无效')
        if(data.entries.some(e=>e.key===key&&e.id!==old?.id))throw new TypeError('主题key已存在，请更新原记忆')
        entry={id:old?.id||`mem_${randomUUID()}`,scope,key,title,content,kind,stages,status:'active',revision,created_at:old?.created_at||at,updated_at:at,source:{session_id:context.sessionId,origin:context.source||'ui',user_quote:quote,...(context.source==='memory-maintenance'?{citations:command.citations||[],maintenance_task_id:context.taskId}: {})}}
        if(old)data.entries=data.entries.map(e=>e.id===old.id?entry:e);else data.entries.push(entry)
      }else if(action==='delete'){
        data.entries=data.entries.filter(e=>e.id!==old.id)
        // 删除移除记忆历史正文；既有任务不可变快照仍保留当时输入事实。
        data.history=data.history.filter(event=>event.entry_id!==old.id)
      }else{entry={...old,status:action==='archive'?'archived':'active',revision,updated_at:at,source:{session_id:context.sessionId,origin:context.source||'ui',user_quote:quote,...(context.source==='memory-maintenance'?{citations:command.citations||[],maintenance_task_id:context.taskId}: {})}};data.entries=data.entries.map(e=>e.id===old.id?entry:e)}
      data.revision=revision;data.history.push({revision,action,source:{session_id:context.sessionId,origin:context.source||'ui'},entry_id:entry?.id||old.id,at,entry:entry||null})

return {entry:entry||null,deleted_id:action==='delete'?old.id:null}
}
