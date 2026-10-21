import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { TaskGroupModel, TaskModel, StepModel } from '@agent-modules/task/models'
import { createRecordService } from '../src/records/service.js'
import { serveRecordRoute } from '../src/harness_server/record_routes.js'

test('节点公共历史只返回当前项目/节点，HTTP从步骤关联，拒绝跨节点详情', async t => {
  const root=await mkdtemp(join(tmpdir(),'drama-node-records-')),records=createRecordService(root),project=`p_${randomUUID()}`
  const group=new TaskGroupModel({id:'g',metadata:{project_id:project}}).toJSON(),other=new TaskGroupModel({id:'other',metadata:{project_id:`p_${randomUUID()}`}}).toJSON()
  const task=(id,group_id,node_type,queue_order)=>new TaskModel({id,group_id,node_type,queue_order,group_seq:queue_order}).toJSON()
  const script=task('script','g','script_revision',1),character=task('character','g','character_extraction',2),foreign=task('foreign','other','script_revision',3)
  const step=(id,task_id)=>new StepModel({id,task_id,kind:'generate',http:[{id:`http-${id}`,prompt_id:null,method:'POST',path:'/test',request:{body:id},body:{result:id},ok:true}]}).toJSON()
  records.tasks.store.transaction(records.scope,draft=>{draft.groups.push(group,other);draft.tasks.push(script,character,foreign);draft.steps.push(step('s','script'),step('c','character'),step('f','foreign'))})
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
  const server=createServer((req,res)=>{serveRecordRoute(req,res,new URL(req.url,'http://localhost'),records,json).catch(e=>json(res,500,{message:e.message}))})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await records.dispose();await rm(root,{recursive:true,force:true})})
  const get=(path)=>fetch(`http://127.0.0.1:${server.address().port}/api/drama/${path}${path.includes('?')?'&':'?'}project_id=${project}&node_type=script_revision`)
  const history=await (await get('task-history')).json();assert.equal(history.total,1);assert.deepEqual(history.groups[0].tasks.map(t=>t.id),['script'])
  const detail=await (await get('task-history?id=g')).json();assert.deepEqual(detail.detail.steps.map(s=>s.id),['s'])
  assert.equal((await get('task-history?id=other')).status,404)
  const http=await (await get('http-records')).json();assert.deepEqual(http.records.map(r=>r.id),['http-s'])
  assert.equal((await get('http-records?id=http-c')).status,404)
  assert.equal((await get('http-records?id=http-f')).status,404)
  assert.equal((await (await get('http-records?id=http-s')).json()).record.request.body,'s')
  assert.equal((await get('task-history?offset=-1')).status,422)
})
