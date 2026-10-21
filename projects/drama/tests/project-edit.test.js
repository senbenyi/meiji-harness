import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { createProject } from '../src/node_box/project/create_project.js'
import { editProject } from '../src/node_box/project/edit_project.js'
import { createProjectView } from '../src/client/project-overview.js'
import { mount } from '../src/client/workbench.js'

const supplement = (value, action = 'generate') => ({kind:'rules',node_type:'script_revision',action,field:'supplement',previousValue:'',value})

test('编辑白名单、旧值冲突与规则只允许剧本补充，不改输出及其他节点', async () => {
  const project = await createProject({name:'测试'})
  const next = editProject(project, supplement('独立补充'))
  assert.equal(next.script_revision.rules.rules.generate.supplement,'独立补充')
  assert.deepEqual(next.character_extraction,project.character_extraction)
  assert.deepEqual(next.script_revision.output,project.script_revision.output)
  assert.throws(()=>editProject(next,supplement('覆盖')),/已被修改/)
  assert.throws(()=>editProject(project,{...supplement('覆盖'),field:'base'}),/只允许/)
  assert.throws(()=>editProject(project,{...supplement('覆盖'),node_type:'character_extraction'}),/节点不存在/)
  assert.throws(()=>editProject(project,{kind:'basic_info',values:{id:'other'},previous:{}}),/不允许/)
  project.script_revision.rules.supports_supplement=false
  assert.throws(()=>editProject(project,supplement('覆盖')))
})

test('真实HTTP保存、会话绑定、并发冲突、工作区改名失败及创建重试', async t => {
  const root = await mkdtemp(join(tmpdir(),'drama-edit-')), renamed=[]
  let failRename=false
  const tool = new ProjectService({root,
    workspaceController:{create:async()=>({workspace:{workspaceId:randomUUID()}}),rename:async row=>{if(failRename)throw new Error('rename failed');renamed.push(row.title)}},
    sessionController:{create:async row=>({sessionId:row.sessionId||`session-${randomUUID()}`})},
  })
  const result=await tool.create({name:'原名'},{sessionId:'source',requestId:'create'})
  const handler=createProjectHttpHandler(tool,{authorize:()=>null}),server=createServer(handler)
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  t.after(async()=>{handler.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})})
  const patch=(command,session=result.session_id,headers={'X-Drama-Request':'1'})=>fetch(`http://127.0.0.1:${server.address().port}/api/drama/project?session_id=${session}`,{method:'PATCH',headers,body:JSON.stringify({project_id:result.project_id,command})})
  const basic={kind:'basic_info',values:{name:'新名'},previous:{name:'原名'}}
  assert.equal((await patch(basic,'other')).status,403)
  assert.equal((await patch(basic,result.session_id,{})).status,403)
  assert.equal((await patch(basic)).status,200)
  assert.equal(renamed.at(-1),'新名')
  assert.equal((await patch(basic)).status,409)
  assert.equal((await patch({kind:'original_script',value:'完整原文',previousValue:''})).status,422)
  assert.deepEqual(await Promise.all(['generate','review'].map(action=>patch(supplement(action,action)).then(r=>r.status))),[200,200])
  let snapshot=await tool.snapshot(result.session_id)
  assert.equal(snapshot.project.script_revision.rules.rules.review.supplement,'review')
  assert.equal(snapshot.project.basic_info.original_script,'')
  const originalNode = structuredClone(snapshot.project.script_revision)
  assert.equal((await patch({kind:'import_script',value:'导入文件正文\n第二场',previousValue:''})).status,200)
  assert.equal((await patch({kind:'import_script',value:'覆盖旧值',previousValue:''})).status,409)
  snapshot = await tool.snapshot(result.session_id)
  assert.equal(snapshot.project.basic_info.original_script,'导入文件正文\n第二场')
  assert.deepEqual(snapshot.project.script_revision,originalNode)
  assert.equal((await patch({kind:'node_opinion',value:'保留人物关系',previousValue:''})).status,200)
  assert.equal((await tool.snapshot(result.session_id)).project.script_revision.opinion,'保留人物关系')
  await tool.create({name:'原名'},{sessionId:'source',requestId:'create'})
  assert.equal(renamed.at(-1),'新名')
  failRename=true
  assert.equal((await patch({kind:'basic_info',values:{name:'失败名称'},previous:{name:'新名'}})).status,422)
  assert.equal((await tool.snapshot(result.session_id)).project.basic_info.name,'新名')
})

test('详情只显示剧本，完整输出、编辑失败保留表单、规则回调及销毁', async t => {
  const dom=new JSDOM('<div id="root"><main></main></div>'), previous=globalThis.document
  globalThis.document=dom.window.document
  dom.window.HTMLDialogElement.prototype.show=function(){this.open=true}
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))}
  t.after(()=>{globalThis.document=previous;dom.window.close()})
  let project=await createProject({name:'<img src=x onerror=alert(1)>',original_script:'原文'}), command, fail=true
  project.episodes=[{name:'不展示剧集'}]
  project.script_revision.output={body:'完整正文\n'.repeat(100),summary:'摘要',estimated_duration_seconds:180}
  project.script_revision.node_state.status='generated'
  const root=document.querySelector('main'), view=createProjectView(root,{project,dialogRoot:document.querySelector('#root'),save:async value=>{command=value;if(fail)throw new Error('保存失败');project=editProject(project,value);return project}})
  assert.equal(root.querySelectorAll('[data-section]').length,2)
  assert.equal(root.querySelector('.original-script button').textContent,'查看剧本')
  assert.equal(root.querySelector('img'),null)
  assert.doesNotMatch(root.textContent,/不展示剧集|人物提取|选集/)
  root.querySelector('[aria-label="编辑基本信息"]').click()
  const dialog=document.querySelector('dialog');dialog.querySelector('[name=name]').value='新项目'
  await dialog.querySelector('form').onsubmit({preventDefault(){}})
  assert.equal(dialog.open,true);assert.match(dialog.textContent,/保存失败/)
  fail=false;await dialog.querySelector('form').onsubmit({preventDefault(){}})
  assert.equal(document.querySelector('dialog'),null);assert.equal(root.querySelector('h2').textContent,'新项目')
  assert.equal(command.previous.name,'<img src=x onerror=alert(1)>')
  root.querySelector('[aria-label="打开剧本详情"]').click()
  assert.match(root.textContent,/预估时长 180 秒/)
  assert.ok(root.textContent.includes(project.script_revision.output.body))
  assert.equal(root.querySelector('.summary-preview'),null)
  root.querySelector('[aria-label="查看剧本优化规则"]').click()
  const rules=root.firstElementChild.shadowRoot
  assert.match(rules.textContent,/基础规则/)
  const input=rules.querySelector('textarea:not([readonly])');assert.ok(input)
  input.value='界面补充';input.dispatchEvent(new dom.window.Event('blur'))
  await new Promise(r=>setImmediate(r))
  assert.equal(command.kind,'rules');assert.equal(command.node_type,'script_revision')
  assert.equal(project.script_revision.rules.rules.generate.supplement,'界面补充')
  view.dispose();assert.equal(document.querySelector('.panel-dialog-overlay'),null)
})


test('切换会话关闭编辑弹窗，旧保存响应不覆盖新项目', async t => {
  const dom=new JSDOM('<main></main>'), oldDocument=globalThis.document
  globalThis.document=dom.window.document
  dom.window.HTMLDialogElement.prototype.show=function(){this.open=true}
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))}
  const first=await createProject({name:'项目一'}),second=await createProject({name:'项目二'})
  let session='first',release,saveUrl
  const ui=mount(document.querySelector('main'),{getSessionId:()=>session,Events:class{close(){}},fetcher:async(url,options)=>{
    if(options?.method==='PATCH'){saveUrl=url;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({project:{...first,basic_info:{...first.basic_info,name:'旧响应'}}})})})}
    return {ok:true,json:async()=>({project:url.includes('session_id=first')?first:second})}
  }})
  t.after(()=>{ui.dispose();globalThis.document=oldDocument;dom.window.close()})
  await ui.refresh()
  document.querySelector('[aria-label="编辑基本信息"]').click()
  const dialog=document.querySelector('dialog');dialog.querySelector('[name=name]').value='旧响应'
  const saving=dialog.querySelector('form').onsubmit({preventDefault(){}})
  assert.match(saveUrl,/session_id=first/)
  session='second'
  for(let i=0;i<70&&document.querySelector('h2')?.textContent!=='项目二';i++) await new Promise(r=>setTimeout(r,10))
  assert.equal(document.querySelector('dialog'),null)
  assert.equal(document.querySelector('.panel-dialog-overlay'),null)
  release();await saving
  assert.equal(document.querySelector('h2').textContent,'项目二')
})


test('导入和执行意见使用既有字段，拒绝空剧本、超限和旧值，不允许原文自由编辑', async () => {
  const project=await createProject({name:'导入校验',original_script:'旧文'})
  const imported=editProject(project,{kind:'import_script',value:'新文',previousValue:'旧文'})
  assert.equal(imported.basic_info.original_script,'新文')
  assert.deepEqual(imported.script_revision,project.script_revision)
  assert.throws(()=>editProject(project,{kind:'import_script',value:'  ',previousValue:'旧文'}),/不能为空/)
  assert.throws(()=>editProject(project,{kind:'import_script',value:'中'.repeat(400000),previousValue:'旧文'}),/1MiB/)
  assert.throws(()=>editProject(project,{kind:'node_opinion',value:'意见',previousValue:'旧意见'}),/已被修改/)
  assert.throws(()=>editProject(project,{kind:'original_script',value:'随意编辑',previousValue:'旧文'}),/未知/)
})

test('相同项目的SSE快照不销毁正在加载的素材选择器', async t => {
  const dom=new JSDOM('<main></main>'),previous=globalThis.document
  globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()})
  const project=await createProject({name:'素材选择'}),root=document.querySelector('main')
  let release
  const view=createProjectView(root,{project,save:async()=>project,request:()=>new Promise(resolve=>{release=()=>resolve({assets:[{id:'script',category:'scripts',originalName:'素材剧本'}]})})})
  const selection=root.querySelector('.project-script-import .script-choose').onclick()
  view.update(structuredClone(project));release();await selection
  assert.equal(root.querySelector('.script-picker').hidden,false)
  assert.equal(root.querySelector('.script-picker option:last-child').textContent,'素材剧本')
  view.dispose()
})


test('原稿与优化稿概要使用预览，详情完整只读、可返回，更新保持详情模式，空原稿无查看入口', async t => {
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=previous;dom.window.close()})
  const project=await createProject({name:'预览项目',original_script:'第一行\n第二行\n第三行<img src=x>'})
  project.script_revision.output={body:'优化第一行\n优化第二行\n优化第三行',summary:'详细摘要',estimated_duration_seconds:180}
  const root=document.querySelector('main'),state={},view=createProjectView(root,{project,state})
  t.after(()=>view.dispose())
  assert.equal(root.querySelectorAll('.script-preview').length,2)
  assert.equal(root.querySelector('.original-script-heading button').textContent,'查看剧本')
  root.querySelector('.original-script-heading button').click()
  assert.equal(state.mode,'original-script');assert.equal(root.querySelector('.original-script-full').textContent,project.basic_info.original_script)
  assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('textarea'),null);assert.equal(root.querySelector('.script-preview'),null)
  const next=structuredClone(project);next.basic_info.original_script+='\n更新正文';view.update(next)
  assert.equal(state.mode,'original-script');assert.ok(root.textContent.includes('更新正文'))
  root.querySelector('[aria-label="返回项目概要"]').click()
  root.querySelector('[aria-label="打开剧本详情"]').click()
  assert.equal(state.mode,'script');assert.ok(root.textContent.includes(project.script_revision.output.body));assert.ok(root.textContent.includes('详细摘要'));assert.equal(root.querySelector('.script-preview'),null)
  root.querySelector('[aria-label="返回项目概要"]').click()
  const empty=structuredClone(next);empty.basic_info.original_script='';view.update(empty)
  assert.equal(root.querySelector('.original-script-heading button'),null)
  assert.ok(root.textContent.includes('尚未导入原始剧本'))
})
