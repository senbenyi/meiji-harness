import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {JSDOM} from 'jsdom'
import {ProjectService} from '../src/node_box/project/service.js'
import {SceneImageService} from '../src/node_box/scene_image/service.js'
import {createRecordService} from '../src/records/service.js'
import {createProjectHttpHandler} from '../src/harness_server/project_routes.js'
import {reconcileSceneAssets} from '../src/node_box/scene_extraction/state.js'
import {referenceImage} from '../src/node_box/scene_image/state.js'
import {renderSceneImage} from '../src/node_box/scene_image/ui/panel/index.js'
import {createProjectView} from '../src/client/project-overview.js'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6XcAAAAASUVORK5CYII=','base64')
const ref=`data:image/png;base64,${png.toString('base64')}`
const scene={id:'scene_a',name:'基地',description:'月球科研基地',layout:'主门连接大厅',materials:'金属和玻璃',lighting:'固定照明',entrances_and_routes:'南门通大厅',fixed_landmarks:'中央气闸'}
async function fixture(t,respond=()=>({data:[{b64_json:png.toString('base64')}]})){
 const root=await mkdtemp(join(tmpdir(),'scene-image-')),calls=[]
 const mock=createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const body=JSON.parse(Buffer.concat(chunks));calls.push({path:req.url,body});const result=await respond(body);res.writeHead(result.error?500:200,{'Content-Type':'application/json'});res.end(JSON.stringify(result))})
 await new Promise(r=>mock.listen(0,'127.0.0.1',r))
 const projects=new ProjectService({root,workspaceController:{create:async()=>({workspace:{workspaceId:randomUUID()}}),rename:async()=>{}},sessionController:{create:async req=>({sessionId:req.sessionId})}})
 const records=createRecordService(root),config={baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,text:{model:'test'},image:{model:'gpt-image'},output_language:'zh-CN'},models={read:async()=>config}
 const images=new SceneImageService({projects,records,models}),handler=createProjectHttpHandler(projects,{authorize:()=>null,models,sceneImages:images})
 const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const created=await projects.create({name:'场景图测试',original_script:'基地内交接。'},{sessionId:'source',requestId:'create'})
 const context={sessionId:created.session_id,projectId:created.project_id,requestId:'image'},file=join(root,'projects',created.project_id,'project.json')
 const edit=fn=>projects.writes.run(async()=>{const p=JSON.parse(await readFile(file,'utf8'));await fn(p);await writeFile(file,JSON.stringify(p))})
 await edit(async p=>{p.scene_extraction.scenes=[scene,{...scene,id:'scene_b',name:'基地外部'}];p.scene_extraction.node_state.status='generated';p.scene_extraction.assets=await reconcileSceneAssets([],[],p.scene_extraction.scenes,p.basic_info.aspect_ratio)})
 t.after(async()=>{await handler.dispose();server.closeAllConnections();mock.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>mock.close(r))]);await rm(root,{recursive:true,force:true})})
 const origin=`http://127.0.0.1:${server.address().port}`
 const post=(path,body,marker=true)=>fetch(`${origin}/api/drama/${path}?session_id=${context.sessionId}`,{method:'POST',headers:{'Content-Type':'application/json',...(marker?{'X-Drama-Request':'1'}:{})},body:JSON.stringify({project_id:context.projectId,...body})})
 const snapshot=async()=>(await projects.snapshot(context.sessionId)).project
 return{root,context,file,projects,records,images,models,config,calls,edit,post,snapshot,origin}
}

test('场景图要求与参考保存并进入实际生图请求，结果/鉴权读取/记录/幂等正确',async t=>{
 const f=await fixture(t)
 assert.equal((await f.post('scene-image-inputs',{scene_id:'scene_a',instruction:'冷白灯光与宽阔入口',reference_image:ref,previous_instruction:'',previous_reference_image:''})).status,200)
 let p=await f.snapshot();assert.equal(p.scene_extraction.assets[0].image_generation.reference_image,ref)
 const accepted=await(await f.post('scene-images',{scene_id:'scene_a',instruction:'冷白灯光与宽阔入口',request_id:'first'})).json()
 const report=await f.images.wait(accepted.group_id,f.context.sessionId)
 assert.equal(report.status,'completed');assert.equal(report.saved,true);assert.equal(report.result_reference,'#/scene_extraction/assets')
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].path.endsWith('/images/generations'))
 assert.ok(f.calls[0].body.prompt.includes('冷白灯光与宽阔入口'));assert.ok(f.calls[0].body.prompt.includes('月球科研基地'));assert.ok(f.calls[0].body.prompt.includes('无人'))
 assert.equal(f.calls[0].body.images[0].image_url,ref)
 p=await f.snapshot();const image=p.scene_extraction.assets[0].image_generation
 assert.equal(image.node_state.status,'generated');assert.equal(image.node_state.last_execution.status,'completed');assert.equal(image.aspect_ratio,p.basic_info.aspect_ratio)
 assert.deepEqual(p.scene_extraction.scenes,[scene,{...scene,id:'scene_b',name:'基地外部'}]);assert.equal(p.scene_extraction.assets[1].image_generation.address,'')
 const bytes=await fetch(f.origin+image.address);assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),png)
 assert.equal((await fetch(`${f.origin}/api/drama/scene-image?session_id=other&file=${image.address.split('file=')[1]}`)).status,403)
 assert.notEqual((await fetch(`${f.origin}/api/drama/scene-image?session_id=${f.context.sessionId}&file=../project.json`)).status,200)
 const repeated=await(await f.post('scene-images',{scene_id:'scene_a',instruction:'冷白灯光与宽阔入口',request_id:'first'})).json();assert.equal(repeated.group_id,accepted.group_id);assert.equal(f.calls.length,1)
 assert.notEqual((await f.post('scene-images',{scene_id:'scene_b',request_id:'first'})).status,202)
 const detail=f.records.tasks.detail(f.records.scope,accepted.group_id);assert.equal(detail.tasks[0].metadata.input_snapshot.reference_image,ref)
 assert.equal((await fetch(`${f.origin}/plugins/drama/src/node_box/scene_image/ui/panel/index.js`)).status,200)
 assert.equal((await fetch(`${f.origin}/plugins/drama/src/node_box/scene_image/service.js`)).status,404)
 const other=await f.images.generate({scene_id:'scene_b'},{...f.context,requestId:'other-scene'});await f.images.wait(other.group_id,f.context.sessionId)
 p=await f.snapshot();assert.equal(p.scene_extraction.assets[0].image_generation.address,image.address)
 assert.notEqual(p.scene_extraction.assets[0].image_generation.node_state.last_execution.task_id,p.scene_extraction.assets[1].image_generation.node_state.last_execution.task_id)
 assert.equal(f.calls[1].body.images,undefined)
})

test('失败保留旧场景图，停止原因可轮询；重新生成读取新要求，不夹带人物资料',async t=>{
 let fail=false;const f=await fixture(t,()=>fail?{error:{message:'图片模型失败'}}:{data:[{b64_json:png.toString('base64')}]})
 const first=await f.images.generate({scene_id:'scene_a'},f.context);await f.images.wait(first.group_id,f.context.sessionId)
 const old=(await f.snapshot()).scene_extraction.assets[0].image_generation.address
 fail=true;const next=await f.images.generate({scene_id:'scene_a',instruction:'保留气闸'},{...f.context,requestId:'failed'})
 const report=await f.images.wait(next.group_id,f.context.sessionId)
 assert.equal(report.status,'failed');assert.equal(report.saved,false);assert.equal(report.requires_user_decision,true)
 const p=await f.snapshot();assert.equal(p.scene_extraction.assets[0].image_generation.address,old)
 assert.equal(p.scene_extraction.assets[0].image_generation.node_state.last_execution.stop_code,'request_failed')
 const states=await f.projects.nodeStates(f.context.sessionId);assert.equal(states.nodes['/scene_extraction/assets/0/image_generation'].last_execution.status,'failed')
 assert.equal(f.calls[0].body.images,undefined)
 assert.equal(f.calls[1].body.prompt.includes('保留气闸'),true);assert.equal(f.calls[1].body.prompt.includes('character_extraction'),false)
 fail=false;const retry=await f.images.generate({instruction:'保留气闸',retry_of:next.group_id},{...f.context,source:'ui',retryAction:'regenerate',requestId:'retry'});assert.equal((await f.images.wait(retry.group_id,f.context.sessionId)).status,'completed')
})

test('参考校验、冲突、会话归属、场景前置及项目互斥拒绝非法请求',async t=>{
 const f=await fixture(t)
 for(const value of ['https://example.com/image.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YWJj'])assert.throws(()=>referenceImage(value),/参考图/)
 assert.throws(()=>referenceImage(`data:image/png;base64,${Buffer.alloc(8*1024*1024+1).toString('base64')}`),/参考图/)
 assert.equal((await f.post('scene-images',{scene_id:'scene_a',request_id:'no-marker'},false)).status,403)
 await assert.rejects(f.images.generate({scene_id:'scene_a'},{...f.context,projectId:'other'}),/未绑定/)
 await assert.rejects(f.images.saveInputs({scene_id:'scene_a',instruction:'新要求',reference_image:'',previous_instruction:'错误旧值',previous_reference_image:''},f.context),/已变化/)
 await f.edit(p=>{p.scene_extraction.node_state.status='expired'})
 await assert.rejects(f.images.generate({scene_id:'scene_a'},f.context),/先完成场景/);assert.equal(f.calls.length,0)
 await f.edit(p=>{p.scene_extraction.node_state.status='generated'})
 await f.images.saveInputs({scene_id:'scene_a',instruction:'',reference_image:ref,previous_instruction:'',previous_reference_image:''},f.context)
 f.config.image.model='krea2 turbo V2.5';await assert.rejects(f.images.generate({scene_id:'scene_a'},f.context),/不支持参考图/);assert.equal(f.calls.length,0)
})

test('运行快照可定位场景；修改输入和并发任务拒绝，场景变化拒绝迟到图片',async t=>{
 let entered,release;const started=new Promise(r=>{entered=r})
 const f=await fixture(t,async()=>{entered();await new Promise(r=>{release=r});return{data:[{b64_json:png.toString('base64')}]}})
 const accepted=await f.images.generate({scene_id:'scene_a'},f.context);await started
 const project=await(await fetch(`${f.origin}/api/drama/project?session_id=${f.context.sessionId}`)).json()
 assert.equal(project.scene_image_execution.scene_id,'scene_a');assert.equal(project.scene_image_execution.status,'running')
 assert.equal((await f.projects.nodeStates(f.context.sessionId)).nodes['/scene_extraction/assets/0/image_generation'].active_execution.scene_id,'scene_a')
 await assert.rejects(f.images.generate({scene_id:'scene_b'},{...f.context,requestId:'concurrent'}),/已有/)
 await assert.rejects(f.images.saveInputs({scene_id:'scene_a',instruction:'变化',reference_image:'',previous_instruction:'',previous_reference_image:''},f.context),/正在执行/)
 await f.edit(p=>{p.scene_extraction.scenes[0].layout='主门改为东侧'})
 release();const report=await f.images.wait(accepted.group_id,f.context.sessionId);assert.equal(report.status,'failed');assert.equal(report.saved,false)
 assert.equal((await f.snapshot()).scene_extraction.assets[0].image_generation.address,'')
})

test('场景卡片参考/结果同排，上传保存、要求传入、连点去重、切会话不回写',async t=>{
 const f=await fixture(t),project=await f.snapshot(),dom=new JSDOM('<main/>'),previous=globalThis.document
 globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()})
 const root=document.querySelector('main'),state={},saves=[],calls=[];let release,current=true,execution
 const operation={isCurrent:()=>current,saveInputs:async v=>{saves.push(v)},generate:(payload,id)=>{calls.push({payload,id});return new Promise(r=>{release=r})},setExecution:v=>{execution=v},repaint:()=>{}}
 renderSceneImage(root,scene,project,{state,sceneImages:operation})
 const file=root.querySelector('input[type=file]');Object.defineProperty(file,'files',{value:[new dom.window.File([png],'base.png',{type:'image/png'})]});await file.onchange()
 assert.equal(saves[0].reference_image,ref)
 const input=root.querySelector('textarea');input.value='宽阔入口';input.oninput()
 const run=[...root.querySelectorAll('button')].find(b=>b.textContent==='生成场景图');run.click();run.click();await new Promise(r=>setImmediate(r))
 assert.equal(calls.length,1);assert.equal(calls[0].payload.instruction,'宽阔入口');assert.equal(saves.at(-1).instruction,'宽阔入口')
 assert.ok(root.querySelector('.scene-image-strip > .scene-image-reference'));assert.ok(root.querySelector('.scene-image-strip > .scene-image-result'))
 current=false;release({group_id:'late',status:'queued'});await new Promise(r=>setImmediate(r));assert.equal(execution,undefined)
})

test('项目视图透传场景图接口、要求和排队状态，不跳出场景页',async t=>{
 const f=await fixture(t),project=await f.snapshot(),dom=new JSDOM('<main/>'),previous=globalThis.document
 globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()})
 const calls=[],root=document.querySelector('main'),view=createProjectView(root,{project,state:{mode:'production',productionTab:'scene_extraction'},generateSceneImages:async(payload,id)=>{calls.push({payload,id});return{group_id:'ui-scene-image',status:'queued'}},saveSceneImageInputs:async()=>{},refresh:()=>{}})
 t.after(()=>view.dispose())
 const run=[...root.querySelectorAll('.scene-image-controls>button')].find(b=>b.textContent==='生成场景图');run.click();await new Promise(r=>setImmediate(r))
 assert.equal(calls.length,1);assert.equal(calls[0].payload.scene_id,'scene_a');assert.equal(root.querySelector('[aria-selected=true]').textContent,'场景')
 assert.match(root.querySelector('.scene-image-progress').textContent,/排队/)
 assert.ok([...root.querySelectorAll('.scene-image-controls>button')].every(b=>b.disabled))
})
