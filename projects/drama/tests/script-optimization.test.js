import { scriptOutput, scriptSummary } from '../src/node_runtime/node_state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { ScriptRevisionService } from '../src/node_box/script_revision/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { OptimizeScriptTool } from '../src/tools/optimize_script_tool.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectView } from '../src/client/project-overview.js'

const candidate = (body = '优化后的完整剧本') => ({ actual_script: body, summary: '剧情摘要', estimated_duration_seconds: 180 })
const passed = { status: 'passed', issues: [] }
const issue = (status = 'content_issue') => ({ status, issues: [{ location: 'body', reason: '动作与要求不一致', suggestion: '按要求修正动作' }] })
async function fixture(t, response, { script = '原稿：主角走进房间。' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'drama-script-run-')), calls = []
  const mock = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks)), projectReview = body.messages[0].content.includes('你是主Agent的项目审核')
      const action = projectReview ? 'project_review' : body.messages.find(m => m.role === 'system').content.match(/动作：(\w+)/)[1]
      const call = { ...body, action }; calls.push(call)
      const value = await response(call, calls.length)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }))
    } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const config = { baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, output_language: 'zh-CN', text: { model: 'writer-test' }, session: { model: 'main-test' } }
  const controllers = { workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} }, sessionController: { create: async request => ({ sessionId: request.sessionId }) } }
  const projects = new ProjectService({ root, ...controllers }), models = { read: async () => config }
  projects.records = createRecordService(root)
  const scriptRevision = new ScriptRevisionService({ projects, records: projects.records, models })
  const handler = createProjectHttpHandler(projects, { authorize: req => req.headers['x-test-user'] ? null : 401, models, scriptRevision }), server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const created = await projects.create({ name: '测试剧本项目', original_script: script }, { sessionId: 'source', requestId: 'create' })
  const context = { sessionId: created.session_id, projectId: created.project_id, requestId: 'optimize' }
  const base = `http://127.0.0.1:${server.address().port}`, request = (path, options = {}) => fetch(base + path, { ...options, headers: { 'X-Test-User': '1', ...options.headers } })
  t.after(async () => { await handler.dispose(); server.closeAllConnections(); mock.closeAllConnections(); await Promise.all([new Promise(r => server.close(r)), new Promise(r => mock.close(r))]); await rm(root, { recursive: true, force: true }) })
  return { root, projects, scriptRevision, calls, created, context, request, base, models, controllers }
}
async function run(f, instruction = '人物改为缓慢转身') {
  const result = await f.scriptRevision.optimizeScript({ instruction }, f.context)
  return f.scriptRevision.waitScriptOptimization(result.group_id, f.context.sessionId)
}

test('优化生成/本地审核真实模拟HTTP并返回主Agent报告，字段保存且记录关联、幂等、源会话隔离', async t => {
  const f = await fixture(t, call => call.action === 'generate' ? candidate() : passed)
  const tool = new OptimizeScriptTool({ scriptRevision: f.scriptRevision })
  const result = JSON.parse(await tool.execute({ instruction: '人物改为缓慢转身' }, { callId: 'optimize', agent: { session: { id: f.context.sessionId } } }))
  assert.equal(result.status, 'completed'); assert.equal(result.summary, '剧情摘要')
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(scriptSummary(project), {summary:'剧情摘要',estimated_duration_seconds:180}); assert.match(project.basic_info.original_script_file_path, /^sources\//); assert.deepEqual(scriptOutput(project), candidate()); assert.equal(project.basic_info.script_revision_node.status, 'generated')
  assert.deepEqual(f.calls.map(call => [call.action, call.model]), [['generate','writer-test'],['review','writer-test']])
  assert.ok(f.calls.every(call => JSON.stringify(call.messages).includes('人物改为缓慢转身')))
  assert.ok(f.calls.every(call => !JSON.stringify(call.messages).includes('character_extraction')))
  const detail = f.projects.records.tasks.detail('drama', result.group_id)
  assert.equal(detail.steps.length, 2)
  const history = await (await f.request(`/api/drama/task-history?unit=task&project_id=${f.created.project_id}&node_type=script_revision&status=completed`)).json()
  assert.equal(history.total,1);assert.equal(history.tasks[0].id,detail.tasks[0].id)
  const unrelated = await (await f.request(`/api/drama/task-history?unit=task&project_id=p_00000000-0000-0000-0000-000000000000&node_type=script_revision`)).json()
  assert.equal(unrelated.total,0)
  assert.equal(detail.tasks[0].metadata.input_snapshot.current_script.actual_script, '原稿：主角走进房间。')
  assert.ok(f.calls.every(call => !Object.hasOwn(JSON.parse(call.messages.find(message=>message.role==='user').content.split('# 本次资料\n')[1]),'original_script')))
  assert.equal((await f.projects.readOriginalScript(f.context.sessionId)).body,'原稿：主角走进房间。')
  assert.equal(detail.tasks[0].metadata.input_snapshot.output_language, 'zh-CN')
  assert.equal(detail.tasks[0].metadata.input_snapshot.instruction, '人物改为缓慢转身')
  for (const step of detail.steps) {
    assert.ok(step.prompt.id); assert.equal(step.http.length, 1)
    assert.equal(step.http[0].prompt_id, step.prompt.id)
    const row = f.projects.records.http.read(step.http[0].id)
    assert.ok(row); assert.equal(row.ok, true); assert.equal(row.params.model, step.prompt.model)
    assert.deepEqual(row.params.messages, step.prompt.messages)
  }
  const again = await run(f); assert.equal(again.group_id, result.group_id); assert.equal(f.calls.length, 2)
  await assert.rejects(f.scriptRevision.optimizeScript({ instruction: '不同要求' }, f.context), /同一请求/)
  await assert.rejects(f.scriptRevision.optimizeScript({ instruction: '修改' }, { ...f.context, sessionId: 'source' }), { code: 'PROJECT_SCOPE' })
  const reopened = createRecordService(f.root)
  assert.equal(reopened.tasks.detail('drama', result.group_id).status, 'completed'); await reopened.dispose()
})

test('已有优化稿按意见修订，本地与项目审核内容问题自动接续独立步骤，不覆盖规则和原稿', async t => {
  let generation = 0, reviews = 0
  const f = await fixture(t, call => {
    if (['generate','revise'].includes(call.action)) return candidate('第' + (++generation) + '稿')
    return ++reviews <= 2 ? issue() : passed
  })
  const result = await run(f)
  assert.equal(result.status, 'completed'); assert.equal(generation, 3)
  const detail = f.projects.records.tasks.detail('drama', result.group_id)
  assert.equal(detail.tasks.length, 1)
  assert.ok(detail.steps.every(step => step.task_id === result.task_id))
  assert.deepEqual(detail.steps.map(s => s.kind), ['generate','review','revise','review','revise','review'])
  f.context.requestId = 'next'
  const next = await run(f, '继续优化对白')
  assert.notEqual(next.task_id, result.task_id)
  assert.equal(f.projects.records.tasks.detail('drama', result.group_id).steps.length, 6)
  assert.equal(f.projects.records.tasks.detail('drama', next.group_id).steps[0].kind, 'revise')
})

test('面板harness-http与会话Tool并发提交同一优化请求，仅执行一次且快照保留执行状态', async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const f = await fixture(t, async call => {
    if (call.action === 'generate') { entered(); await gate; return candidate() }
    return passed
  })
  t.after(() => release())
  const tool = new OptimizeScriptTool({ scriptRevision: f.scriptRevision })
  const conversation = tool.execute({ instruction: '共同优化' }, { callId: 'shared', agent: { session: { id: f.context.sessionId } } })
  const response = await f.request(`/api/drama/script-optimization?session_id=${f.context.sessionId}`, {
    method: 'POST', headers: { 'X-Drama-Request': '1' },
    body: JSON.stringify({ project_id: f.context.projectId, request_id: 'shared', instruction: '共同优化' }),
  })
  assert.equal(response.status, 202)
  const accepted = await response.json(); await started
  const snapshot = await (await f.request(`/api/drama/project?session_id=${f.context.sessionId}`)).json()
  assert.equal(snapshot.script_execution.group_id, accepted.group_id)
  assert.equal(snapshot.script_execution.status, 'running')
  assert.equal(snapshot.script_execution.step.kind, 'generate')
  assert.deepEqual(snapshot.script_execution.review_issues, [])
  await assert.rejects(f.projects.remove(f.context), { code: 'PROJECT_ACTIVE' })
  release()
  const result = JSON.parse(await conversation)
  assert.equal(result.group_id, accepted.group_id); assert.equal(result.status, 'completed')
  assert.deepEqual(f.calls.map(call => call.action), ['generate', 'review'])
  assert.equal(f.projects.records.tasks.store.read('drama').tasks.filter(task => task.node_type === 'script_revision').length, 1)
})

for (const status of ['rule_conflict','upstream_issue','repeated']) test('审核停止：' + status + '，保存候选且不改规则/上游', async t => {
  const f = await fixture(t, call => ['generate','revise'].includes(call.action) ? candidate() : issue(status === 'repeated' ? 'content_issue' : status))
  const before = (await f.projects.snapshot(f.context.sessionId)).project
  const result = await run(f), after = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(result.status, 'rejected'); assert.equal(result.saved, true); assert.deepEqual(scriptOutput(after), candidate())
  assert.deepEqual(f.projects.records.tasks.detail('drama',result.group_id).steps.findLast(step=>step.result?.output)?.result.output,candidate())
  assert.deepEqual(after.basic_info.script_revision_node.rules, before.basic_info.script_revision_node.rules); assert.equal(after.basic_info.original_script_file_path, before.basic_info.original_script_file_path)
  assert.equal(after.basic_info.script_revision_node.status, 'rejected')
  assert.equal(f.calls.length, status === 'repeated' ? 4 : 2)
})

test('结构错误不保存，缺原稿不发请求，已有任务阻止重复任务和资料修改', async t => {
  const bad = await fixture(t, () => ({ actual_script: '缺字段' }))
  const before = scriptOutput((await bad.projects.snapshot(bad.context.sessionId)).project)
  assert.equal((await run(bad)).status, 'failed')
  assert.deepEqual(scriptOutput((await bad.projects.snapshot(bad.context.sessionId)).project), before)
  const empty = await fixture(t, () => candidate(), { script: '' })
  await assert.rejects(run(empty), /导入原始剧本/); assert.equal(empty.calls.length, 0)
  let release, entered
  const gate = new Promise(r => { release = r }), started = new Promise(r => { entered = r })
  const slow = await fixture(t, async call => { if (call.action === 'generate') { entered(); await gate; return candidate() } return passed })
  const accepted = await slow.scriptRevision.optimizeScript({ instruction: '改动作' }, slow.context); await started
  await assert.rejects(slow.scriptRevision.optimizeScript({ instruction: '另一个' }, { ...slow.context, requestId: 'other' }), { code: 'PROJECT_ACTIVE' })
  await assert.rejects(slow.projects.edit({ kind: 'import_script', value: '新稿', previousValue: '原稿：主角走进房间。' }, slow.context), { code: 'PROJECT_ACTIVE' })
  slow.projects.records.tasks.cancel('drama', accepted.group_id, '测试取消'); release()
  await slow.projects.records.tasks.idle('drama')
  assert.equal(slow.projects.records.tasks.detail('drama', accepted.group_id).status, 'cancelled')
  assert.equal((await slow.projects.snapshot(slow.context.sessionId)).project.basic_info.actual_script, '原稿：主角走进房间。')
})

test('优化HTTP鉴权/绑定/请求标识、异步返回与完成后快照；下游保留内容并过期', async t => {
  const f = await fixture(t, call => call.action === 'generate' ? candidate() : passed)
  const file = join(f.root, 'projects', f.context.projectId, 'project.json')
  const data = JSON.parse(await readFile(file, 'utf8')); data.story_segments.node_state.status = 'generated'; data.story_segments.segments = [{ id: 'old', body: '旧内容' }]
  const { writeFile } = await import('node:fs/promises'); await writeFile(file, JSON.stringify(data))
  const path = `/api/drama/script-optimization?session_id=${f.context.sessionId}`, options = { method: 'POST', body: JSON.stringify({ project_id: f.context.projectId, request_id: 'http', instruction: '优化节奏' }) }
  assert.equal((await fetch(f.base + path, options)).status, 401)
  assert.equal((await f.request(path, options)).status, 403)
  options.headers = { 'X-Drama-Request': '1' }
  assert.equal((await f.request(path.replace(f.context.sessionId, 'other'), options)).status, 403)
  const response = await f.request(path, options); assert.equal(response.status, 202)
  const result = await response.json(); await f.scriptRevision.waitScriptOptimization(result.group_id, f.context.sessionId)
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(project.story_segments.node_state.status, 'expired'); assert.equal(project.story_segments.segments[0].body, '旧内容')
})

test('页面按意见改编使用当前输入和稳定请求ID，执行状态禁用按钮，详情与历史入口保留', async t => {
  const { createProject } = await import('../src/node_box/project/create_project.js')
  const dom = new JSDOM('<main/>'), old = globalThis.document; globalThis.document = dom.window.document
  t.after(() => { globalThis.document = old; dom.window.close() })
  const project = await createProject({ name: '界面', original_script: '原稿' }), root = document.querySelector('main'), calls = []
  const view = createProjectView(root, { project, request: async () => ({}), optimize: async (...args) => { calls.push(args); return { group_id: 'group', status: 'queued' } } })
  t.after(() => view.dispose())
  const input = root.querySelector('.node-ui-opinion'); input.value = '人物缓慢转身'; input.oninput()
  await root.querySelector('.node-ui-execution button').onclick()
  assert.equal(calls[0][0], '人物缓慢转身'); assert.match(calls[0][1], /^[a-f0-9-]{36}$/)
  assert.equal(root.querySelector('.node-ui-execution button').disabled, true)
  assert.ok(root.textContent.includes('等待执行'))
  view.update(project, { scriptExecution: null }); assert.equal(root.querySelector('.node-ui-execution button').disabled, false)
})

test('Service属性限定三轮自动修订，到上限仍不通过则保留候选并报告', async t => {
  let generation = 0
  const f = await fixture(t, call => ['generate','revise'].includes(call.action) ? candidate('版本' + (++generation)) : issue())
  assert.equal(f.scriptRevision.maxRevisionRounds,3)
  const result=await run(f)
  assert.equal(result.status,'rejected');assert.equal(result.decision,'content_issue');assert.doesNotMatch(result.reason,/最大修订轮次/)
  assert.equal(generation,4);assert.equal(f.calls.length,8)
  const detail=f.projects.records.tasks.detail('drama',result.group_id)
  assert.deepEqual(detail.steps.filter(step=>step.kind==='revise').map(step=>step.round),[1,2,3])
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.basic_info.actual_script,'版本4')
})

test('第三轮审核通过可成功，Executor读取Service属性而不是自己的固定轮数', async t => {
  let count=0
  const f=await fixture(t,call=>['generate','revise'].includes(call.action)?candidate('稿'+(++count)):count===4?passed:issue())
  assert.equal((await run(f)).status,'completed');assert.equal(count,4)
  const shorter=await fixture(t,(call,n)=>['generate','revise'].includes(call.action)?candidate('稿'+n):issue())
  shorter.scriptRevision.maxRevisionRounds=1
  const stopped=await run(shorter)
  assert.equal(stopped.status,'rejected');assert.equal(shorter.calls.length,4);assert.equal(stopped.decision,'content_issue');assert.doesNotMatch(stopped.reason,/1轮/)
})

test('已有稿首次按意见修改不占自动修订轮数，后续仍最多三轮', async t => {
  let initial=true,count=0
  const f=await fixture(t,call=>['generate','revise'].includes(call.action)?candidate('稿'+(++count)):initial?passed:issue())
  await run(f);initial=false;f.context.requestId='second'
  const result=await run(f,'新的本次修改意见')
  const detail=f.projects.records.tasks.detail('drama',result.group_id)
  assert.equal(result.status,'rejected')
  assert.deepEqual(detail.steps.filter(step=>step.kind==='revise').map(step=>step.round),[0,1,2,3])
})

test('执行期间外部原稿变化拒绝晚结果覆盖；中断任务重开恢复为失败，不自动重放', async t => {
  let release, entered
  const gate = new Promise(r => { release = r }), started = new Promise(r => { entered = r })
  const f = await fixture(t, async () => { entered(); await gate; return candidate() })
  const accepted = await f.scriptRevision.optimizeScript({ instruction: '优化' }, f.context); await started
  const file = join(f.root, 'projects', f.context.projectId, 'project.json'), project = JSON.parse(await readFile(file, 'utf8'))
  project.basic_info.original_script_file_path = '外部更新原稿'
  const { writeFile } = await import('node:fs/promises'); await writeFile(file, JSON.stringify(project)); release()
  assert.equal((await f.scriptRevision.waitScriptOptimization(accepted.group_id, f.context.sessionId)).status, 'failed')
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.basic_info.actual_script, '原稿：主角走进房间。')
  const records = f.projects.records
  const pending = records.tasks.submit('drama', { tasks: [{ node_type: 'script_revision', metadata: { project_id: f.context.projectId } }] })
  records.tasks.store.transaction('drama', data => { const task = data.tasks.find(row => row.group_id === pending.group.id); task.task_status = 'running'; task.started_at = new Date().toISOString() })
  const reopened = createRecordService(f.root); reopened.tasks.recover('drama')
  assert.equal(reopened.tasks.detail('drama', pending.group.id).status, 'failed'); await reopened.dispose()
})

test('步骤区审核黄、问题修订红、再审核黄，标题执行中稳定并在通过后更新', { timeout: 10000 }, async t => {
  const gate=()=>{let enter,release;return {entered:new Promise(resolve=>enter=resolve),wait:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()}}
  const firstReview=gate(),revision=gate(),secondReview=gate()
  t.after(()=>{firstReview.release();revision.release();secondReview.release()})
  let reviews=0
  const f=await fixture(t,async call=>{
    if(call.action==='generate')return candidate('第一稿')
    if(call.action==='revise'){revision.enter();await revision.wait;return candidate('第二稿')}
    if(++reviews===1){firstReview.enter();await firstReview.wait;return issue()}
    secondReview.enter();await secondReview.wait;return passed
  })
  const dom=new JSDOM('<main/>'),old=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=old;dom.window.close()})
  const result=await f.scriptRevision.optimizeScript({instruction:'明确人物动作'},f.context)
  const read=async()=>{
    const response=await f.request(`/api/drama/project?session_id=${f.context.sessionId}`)
    assert.equal(response.status,200);return response.json()
  }
  await firstReview.entered
  let snapshot=await read()
  assert.equal(snapshot.script_execution.step.kind,'review');assert.deepEqual(snapshot.script_execution.review_issues,[])
  assert.equal(Object.hasOwn(snapshot.script_execution.step,'prompt'),false)
  const root=document.querySelector('main'),view=createProjectView(root,{project:snapshot.project,scriptExecution:snapshot.script_execution})
  t.after(()=>view.dispose())
  assert.equal(root.querySelector('.script-node').dataset.status,'empty')
  assert.equal(root.querySelector('.node-data-tag').textContent,'未生成')
  assert.equal(root.querySelector('.node-ui-reason'),null)
  assert.match(root.querySelector('.node-ui-step').textContent,/当前步骤：审核/)
  assert.equal(root.textContent.includes('未通过'),false)
  firstReview.release();await revision.entered
  snapshot=await read();view.update(snapshot.project,{scriptExecution:snapshot.script_execution})
  assert.equal(snapshot.script_execution.step.kind,'revise')
  assert.deepEqual(snapshot.script_execution.review_issues,issue().issues)
  assert.equal(root.querySelector('.script-node').dataset.status,'empty')
  assert.equal(root.querySelector('.node-data-tag').textContent,'未生成')
  assert.match(root.querySelector('.node-ui-step').textContent,/当前步骤：修订\n未通过原因：body：动作与要求不一致；按要求修正动作/)
  assert.ok(root.querySelector('.node-ui-step').classList.contains('is-rejected'))
  assert.equal(root.querySelector('.node-ui-execution button').textContent,'按意见修改')
  assert.equal(root.querySelector('.node-ui-execution button').disabled,true)
  revision.release();await secondReview.entered
  snapshot=await read();view.update(snapshot.project,{scriptExecution:snapshot.script_execution})
  assert.equal(root.querySelector('.node-data-tag').textContent,'未生成')
  assert.equal(root.querySelector('.script-node').dataset.status,'empty')
  assert.equal(root.querySelector('.node-ui-step').textContent,'当前步骤：审核')
  assert.equal(root.querySelector('.node-ui-step').classList.contains('is-rejected'),false)
  assert.equal(root.querySelector('.node-ui-reason'),null)
  secondReview.release();await f.scriptRevision.waitScriptOptimization(result.group_id,f.context.sessionId)
  snapshot=await read();view.update(snapshot.project,{scriptExecution:snapshot.script_execution||null})
  assert.equal(snapshot.script_execution,undefined)
  assert.equal(root.querySelector('.node-data-tag').textContent,'已生成')
  assert.equal(root.querySelector('.script-node').dataset.status,'generated')
})

test('旧候选待审核不伪报失败，排队/重新生成不展示旧拒绝，最终拒绝仍显示具体原因', async t=>{
  const {createProject}=await import('../src/node_box/project/create_project.js')
  const dom=new JSDOM('<main/>'),old=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=old;dom.window.close()})
  const project=await createProject({name:'阶段展示',original_script:'原稿'})
  project.basic_info.script_revision_node={status:'rejected',reason:'候选已保存，等待审核',dependency_hash:''}
  const root=document.querySelector('main'),view=createProjectView(root,{project})
  t.after(()=>view.dispose())
  assert.equal(root.querySelector('.node-data-tag').textContent,'待审核')
  assert.equal(root.querySelector('.script-node').dataset.status,'pending_review')
  assert.equal(root.textContent.includes('未通过原因'),false)
  const rejected=structuredClone(project);rejected.basic_info.script_revision_node.reason='上游人物身份冲突'
  view.update(rejected,{scriptExecution:{group_id:'g',status:'queued'}})
  assert.equal(root.querySelector('.node-data-tag').textContent,'未通过');assert.equal(root.querySelector('.node-ui-reason'),null)
  assert.match(root.querySelector('.node-ui-step').textContent,/当前步骤：前置/)
  view.update(rejected,{scriptExecution:{group_id:'g',status:'running',step:{kind:'generate'}}})
  assert.equal(root.querySelector('.node-data-tag').textContent,'未通过');assert.equal(root.querySelector('.node-ui-reason'),null)
  assert.equal(root.querySelector('.node-ui-step').textContent,'当前步骤：生成')
  const accepted=structuredClone(project);accepted.basic_info.script_revision_node={status:'generated',reason:'',dependency_hash:''}
  view.update(accepted,{scriptExecution:{group_id:'g',status:'running',step:{kind:'revise'},review_issues:[]}})
  assert.equal(root.querySelector('.node-data-tag').textContent,'已生成')
  assert.equal(root.querySelector('.script-node').dataset.status,'generated')
  assert.equal(root.querySelector('.node-ui-step').textContent,'当前步骤：生成')
  assert.equal(root.querySelector('.node-ui-reason'),null)
  view.update(rejected,{scriptExecution:{group_id:'new-task',status:'running',step:{kind:'revise'},review_issues:[]}})
  assert.equal(root.querySelector('.node-data-tag').textContent,'未通过')
  assert.equal(root.querySelector('.script-node').dataset.status,'rejected')
  assert.equal(root.querySelector('.node-ui-step').textContent,'当前步骤：生成')
  assert.equal(root.querySelector('.node-ui-reason'),null)
  view.update(rejected,{scriptExecution:null})
  assert.equal(root.querySelector('.node-data-tag').textContent,'未通过')
  assert.match(root.querySelector('.node-ui-reason').textContent,/未通过原因：上游人物身份冲突/)
})

test('提交前置时标题和按钮文案不变，执行中禁用守卫阻止重复提交，刷新沿用Task初始节点状态', async t=>{
  const {createProject}=await import('../src/node_box/project/create_project.js')
  const dom=new JSDOM('<main/>'),old=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=old;dom.window.close()})
  const project=await createProject({name:'固定状态',original_script:'原稿'})
  project.basic_info.script_revision_node={status:'generated',reason:'',dependency_hash:'before'}
  let release,calls=0
  const pending=new Promise(resolve=>release=resolve)
  const root=document.querySelector('main'),view=createProjectView(root,{project,optimize:async()=>{calls++;await pending;return {group_id:'g',status:'queued'}}})
  t.after(()=>{release();view.dispose()})
  const submitting=root.querySelector('.node-ui-execution button').onclick()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(root.querySelector('.node-data-tag').textContent,'已生成')
  assert.equal(root.querySelector('.node-ui-execution button').textContent,'按意见修改')
  assert.equal(root.querySelector('.node-ui-execution button').disabled,true)
  assert.match(root.querySelector('.node-ui-step').textContent,/当前步骤：前置/)
  await root.querySelector('.node-ui-execution button').onclick();assert.equal(calls,1)
  release();await submitting
  const working=structuredClone(project);working.basic_info.script_revision_node={status:'rejected',reason:'候选已保存，等待审核',dependency_hash:'new'}
  const execution={group_id:'g',status:'running',step:{kind:'review'},node_state_before:project.basic_info.script_revision_node,review_issues:[]}
  view.update(working,{scriptExecution:execution})
  assert.equal(root.querySelector('.node-data-tag').textContent,'已生成')
  assert.equal(root.querySelector('.node-ui-step').textContent,'当前步骤：审核')
  view.dispose()
  const restored=createProjectView(root,{project:working,scriptExecution:execution});t.after(()=>restored.dispose())
  assert.equal(root.querySelector('.node-data-tag').textContent,'已生成')
  assert.equal(root.querySelector('.node-ui-step').textContent,'当前步骤：审核')
  assert.equal(root.querySelector('.node-ui-execution button').textContent,'按意见修改')
})

test('复制原文紧邻查看规则，预览模式复制完整正文，空正文没有复制入口', async t=>{
  const {scriptNodeCard}=await import('../src/node_box/script_revision/ui/panel/index.js')
  const {createProject}=await import('../src/node_box/project/create_project.js')
  const dom=new JSDOM('<main/>'),old=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=old;dom.window.close()})
  const project=await createProject({name:'复制位置'}),body='第一行\n第二行\n第三行\n第四行\n第五行：完整原文'
  Object.assign(project.basic_info,{actual_script:body,summary:'摘要',estimated_duration_seconds:20})
  let copied='',copies=0,fail=false
  const card=scriptNodeCard({...project.basic_info,node_state:project.basic_info.script_revision_node},{preview:true,openTasks:()=>{},openRules:()=>{},copyText:async value=>{if(fail)throw Error('denied');copied=value;copies++}})
  document.querySelector('main').append(card)
  assert.deepEqual([...card.querySelectorAll('.node-ui-records button')].map(node=>node.textContent),['任务历史','查看规则','复制原文'])
  assert.equal(card.querySelectorAll('[aria-label="复制该卡片原文"]').length,1)
  assert.equal(card.querySelector('.node-result button'),null)
  const control=card.querySelector('.node-original-copy');await control.onclick()
  assert.equal(copied,body);assert.equal(control.textContent,'复制原文');assert.equal(control.disabled,false)
  assert.equal(document.querySelector('.agent-ui-toast').textContent,'已复制')
  await control.onclick();assert.equal(copies,2);assert.equal(control.textContent,'复制原文')
  fail=true;await control.onclick();assert.equal(document.querySelector('.agent-ui-toast').textContent,'复制失败，请重试');assert.equal(control.disabled,false)
  project.basic_info.actual_script=''
  assert.equal(scriptNodeCard({...project.basic_info,node_state:project.basic_info.script_revision_node}).querySelector('.node-original-copy'),null)
})

test('成功消费意见并持久化清空，审核未通过保留，历史任务指令不变', async t=>{
  for(const [label,review,expected] of [['通过',passed,''],['未通过',issue('upstream_issue'),'本次修改意见']]) await t.test(label,async t=>{
    const f=await fixture(t,call=>call.action==='generate'?candidate():review)
    await f.projects.edit({kind:'node_opinion',value:'本次修改意见',previousValue:''},f.context)
    const result=await run(f,'本次修改意见')
    const snapshot=await f.projects.snapshot(f.context.sessionId)
    assert.equal(snapshot.project.basic_info.script_revision_node.opinion,expected)
    const disk=JSON.parse(await readFile(join(f.root,'projects',f.context.projectId,'project.json'),'utf8'))
    assert.equal(disk.basic_info.script_revision_node.opinion,expected)
    assert.equal(f.projects.records.tasks.detail('drama',result.group_id).tasks[0].metadata.instruction,'本次修改意见')
  })
})

test('优化执行期间另存新意见，审核成功后不清空新意见',async t=>{
  let enter,release
  const started=new Promise(resolve=>enter=resolve),waiting=new Promise(resolve=>release=resolve)
  t.after(()=>release())
  const f=await fixture(t,async call=>{if(call.action==='generate')return candidate();enter();await waiting;return passed})
  await f.projects.edit({kind:'node_opinion',value:'本次修改意见',previousValue:''},f.context)
  const accepted=await f.scriptRevision.optimizeScript({instruction:'本次修改意见'},f.context)
  await started
  await f.projects.edit({kind:'node_opinion',value:'下一次修改意见',previousValue:'本次修改意见'},f.context)
  release();await f.scriptRevision.waitScriptOptimization(accepted.group_id,f.context.sessionId)
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.basic_info.script_revision_node.opinion,'下一次修改意见')
})

test('成功清空快照同步旧输入草稿，未通过与新草稿不被误删',async t=>{
  const {createProject}=await import('../src/node_box/project/create_project.js')
  const dom=new JSDOM('<main/>'),old=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=old;dom.window.close()})
  const project=await createProject({name:'意见消费',original_script:'原稿'});project.basic_info.script_revision_node.opinion='本次修改意见'
  const completed=structuredClone(project);completed.basic_info.script_revision_node.opinion='';completed.basic_info.script_revision_node={...completed.basic_info.script_revision_node,status:'generated',reason:'',dependency_hash:'done'}
  const root=document.querySelector('main'),state={opinionDraft:'本次修改意见'}
  const view=createProjectView(root,{project,state,scriptExecution:{status:'running',step:{kind:'review'}}});t.after(()=>view.dispose())
  view.update(completed,{scriptExecution:null})
  assert.equal(root.querySelector('.node-ui-opinion').value,'');assert.equal(state.opinionDraft,'')
  view.dispose()
  const freshState={opinionDraft:'下一次尚未保存的意见'},fresh=createProjectView(root,{project,state:freshState});t.after(()=>fresh.dispose())
  fresh.update(completed,{scriptExecution:null})
  assert.equal(root.querySelector('.node-ui-opinion').value,'下一次尚未保存的意见')
  fresh.dispose()
  const failed=structuredClone(project);failed.basic_info.script_revision_node={...failed.basic_info.script_revision_node,status:'rejected',reason:'规则冲突',dependency_hash:'failed'}
  const failureState={opinionDraft:'本次修改意见'},failure=createProjectView(root,{project,state:failureState});t.after(()=>failure.dispose())
  failure.update(failed,{scriptExecution:null})
  assert.equal(root.querySelector('.node-ui-opinion').value,'本次修改意见')
})


test('Service显式输入契约：当前稿、要求、语言必选，工作稿为唯一正文；无效调用不创建任务',async t=>{
  const f=await fixture(t,call=>call.action==='review'?passed:candidate())
  const base={current_script:{actual_script:'原稿',summary:'',estimated_duration_seconds:0},instruction:' 改动作 ',output_language:'zh-CN'}
  assert.deepEqual(f.scriptRevision.executionInput(base),{...base,instruction:'改动作'})
  for(const field of ['current_script','instruction','output_language']) {
    const bad={...base};delete bad[field];assert.throws(()=>f.scriptRevision.executionInput(bad),new RegExp(field))
  }
  assert.throws(()=>f.scriptRevision.executionInput({...base,current_script:'旧稿'}),/普通对象/)
  assert.throws(()=>f.scriptRevision.executionInput({...base,reference_episode_duration_seconds:180}),/未声明字段/)
  assert.throws(()=>f.scriptRevision.executionInput({...base,original_script:'不再作为输入'}),/未声明字段/)
  const current=candidate();const resolved=f.scriptRevision.executionInput({...base,current_script:current});resolved.current_script.actual_script='变更'
  assert.equal(current.actual_script,'优化后的完整剧本')
  const before=f.projects.records.tasks.store.read('drama').tasks.length
  assert.throws(()=>f.scriptRevision.optimizeScript({instruction:'改稿'},{}),/sessionId/)
  assert.throws(()=>f.scriptRevision.optimizeScript({instruction:'改稿',retry_of:3},f.context),/retry_of/)
  assert.throws(()=>f.scriptRevision.optimizeScript({instruction:'改稿',creative_requirements:'旧字段'},f.context),/只允许/)
  assert.equal(f.projects.records.tasks.store.read('drama').tasks.length,before)
  const result=await run(f)
  const detail=f.projects.records.tasks.detail('drama',result.group_id)
  for(const step of detail.steps) {
    assert.deepEqual(Object.keys(step.prompt.input).sort(),['current_script','instruction','output_language'].sort())
  }
  const saved=detail.tasks[0].metadata.input_snapshot
  assert.equal(Object.hasOwn(saved,'creative_requirements'),false);assert.equal(Object.hasOwn(saved,'reference_episode_duration_seconds'),false)
  await f.projects.edit({kind:'basic_info',values:{reference_episode_duration_seconds:190},previous:{reference_episode_duration_seconds:180}},f.context)
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.basic_info.script_revision_node.status,'generated','参考时长不再是本节点依赖')
})

test('停止摘要与内容状态独立：再次未通过保存最新正文，轻量轮询不泄露正文和规则，过期不改停止结论', async t => {
  let reject = false
  const f = await fixture(t, call => ['generate', 'revise'].includes(call.action) ? candidate(reject ? '未经审核候选' : '已确认工作正文') : reject ? issue('rule_conflict') : passed)
  const first = await run(f)
  const accepted = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(accepted.basic_info.script_revision_node.last_execution.stop_code, 'completed')
  reject = true; f.context.requestId = 'second-attempt'
  const second = await run(f, '再次改写')
  const current = (await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(scriptOutput(current), candidate('未经审核候选'))
  assert.equal(current.basic_info.script_revision_node.status, 'rejected')
  const last = current.basic_info.script_revision_node.last_execution
  assert.equal(last.task_id, second.task_id); assert.notEqual(last.task_id, first.task_id)
  assert.equal(last.status, 'rejected'); assert.equal(last.stop_code, 'rule_conflict'); assert.match(last.message, /动作与要求/)
  assert.ok(Number.isFinite(Date.parse(last.finished_at)))
  const response = await f.request(`/api/drama/node-states?session_id=${f.context.sessionId}`)
  assert.equal(response.status, 200)
  const states = await response.json()
  assert.equal(states.project_id, f.context.projectId)
  assert.deepEqual(states.nodes.script_revision.last_execution, last)
  assert.equal(states.nodes.script_revision.active_execution, null)
  assert.doesNotMatch(JSON.stringify(states), /已确认工作正文|未经审核候选|"rules"|"supports_supplement"/)
  const saved = JSON.parse(await readFile(join(f.root, 'projects', f.context.projectId, 'project.json'), 'utf8'))
  assert.deepEqual(saved.basic_info.script_revision_node.last_execution, last)
  await f.projects.edit({kind:'rules',node_type:'script_revision',action:'generate',field:'supplement',previousValue:'',value:'新增规则'}, f.context)
  const expired = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(expired.basic_info.script_revision_node.status, 'expired')
  assert.deepEqual(expired.basic_info.script_revision_node.last_execution, last)
})

test('运行中保留上次停止说明且轮询活动任务不带规则；取消不覆盖已确认工作稿', async t => {
  let wait = false, release, entered
  const started = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
  const f = await fixture(t, async call => {
    if (wait && call.action === 'revise') { entered(); await gate }
    return ['generate', 'revise'].includes(call.action) ? candidate() : passed
  })
  t.after(() => release())
  await run(f)
  const before = (await f.projects.snapshot(f.context.sessionId)).project
  wait = true; f.context.requestId = 'cancel-next'
  const accepted = await f.scriptRevision.optimizeScript({instruction:'第二次修改'}, f.context)
  await started
  const states = await f.projects.nodeStates(f.context.sessionId)
  assert.equal(states.nodes.script_revision.active_execution.group_id, accepted.group_id)
  assert.equal(states.nodes.script_revision.active_execution.status, 'running')
  assert.deepEqual(states.nodes.script_revision.last_execution, before.basic_info.script_revision_node.last_execution)
  assert.doesNotMatch(JSON.stringify(states), /"rules"|"node_state_before"|优化后的完整剧本/)
  f.projects.records.tasks.cancel('drama', accepted.group_id, '用户主动取消')
  release(); await f.projects.records.tasks.idle('drama')
  const after = (await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(scriptOutput(after), scriptOutput(before))
  assert.equal(after.basic_info.script_revision_node.last_execution.stop_code, 'cancelled')
  assert.equal(after.basic_info.script_revision_node.last_execution.message, '用户主动取消')
})

test('请求失败与结构异常分别归因，刷新和重启按Task恢复缺失摘要并落盘', async t => {
  const f = await fixture(t, () => { throw new Error('模拟服务故障') })
  const result = await run(f)
  assert.equal(result.status, 'failed')
  const snapshot = await f.projects.snapshot(f.context.sessionId)
  assert.equal(snapshot.project.basic_info.script_revision_node.last_execution.stop_code, 'request_failed')
  assert.equal(snapshot.project.basic_info.actual_script, '原稿：主角走进房间。')
  await f.projects.writes.run(async () => {
    const file = join(f.root, 'projects', f.context.projectId, 'project.json')
    const data = JSON.parse(await readFile(file, 'utf8'))
    data.basic_info.script_revision_node.last_execution = null
    const {writeFile} = await import('node:fs/promises'); await writeFile(file, JSON.stringify(data))
  })
  const restarted = new ProjectService({root:f.root,...f.controllers})
  const reopenedRecords = createRecordService(f.root)
  restarted.enableTaskRecords(reopenedRecords)
  const recovered = await restarted.snapshot(f.context.sessionId)
  assert.deepEqual(recovered.project.basic_info.script_revision_node.last_execution, snapshot.project.basic_info.script_revision_node.last_execution)
  await restarted.writes.run(() => {})
  const disk = JSON.parse(await readFile(join(f.root,'projects',f.context.projectId,'project.json'),'utf8'))
  assert.deepEqual(disk.basic_info.script_revision_node.last_execution, snapshot.project.basic_info.script_revision_node.last_execution)
  await reopenedRecords.dispose()
  const invalid = await fixture(t, () => ({actual_script:'缺少必填字段'}))
  await run(invalid)
  assert.equal((await invalid.projects.snapshot(invalid.context.sessionId)).project.basic_info.script_revision_node.last_execution.stop_code, 'execution_error')
})

test('同工作区恢复会话可执行优化，任务归当前会话且写回同一项目', async t => {
  const f=await fixture(t,call=>call.action==='review'?passed:candidate())
  const sibling='session-restored-workspace'
  f.projects.workspaceForSession=id=>id===sibling?{...f.created.workspace,sessionIds:[f.created.session_id,sibling]}:undefined
  const accepted=await f.scriptRevision.optimizeScript({instruction:'恢复会话优化'},{...f.context,sessionId:sibling})
  const report=await f.scriptRevision.waitScriptOptimization(accepted.group_id,sibling)
  assert.equal(report.status,'completed');assert.equal(report.session_id,sibling)
  const project=(await f.projects.snapshot(sibling)).project
  assert.equal(project.basic_info.id,f.context.projectId)
  assert.deepEqual(scriptOutput(project),candidate())
  assert.equal((await f.projects.snapshot(f.created.session_id)).project.basic_info.script_revision_node.last_execution.task_id,report.task_id)
})

for (const retryAction of ['continue', 'regenerate']) test(`用户${retryAction}优化任务沿用正确输入并保持旧任务`, async t => {
  let allow = false
  const f = await fixture(t, call => call.action === 'review' ? allow ? passed : issue() : candidate('最后候选稿'))
  f.scriptRevision.maxRevisionRounds = 0
  const first = await run(f)
  assert.equal(first.requires_user_decision, true)
  const old = f.projects.records.tasks.detail('drama', first.group_id)
  allow = true
  const accepted = await f.scriptRevision.optimizeScript({ instruction: '人物改为缓慢转身', retry_of: first.group_id }, { ...f.context, source: 'ui', retryAction, requestId: 'user-retry' })
  const report = await f.scriptRevision.waitScriptOptimization(accepted.group_id, f.context.sessionId)
  assert.equal(report.status, 'completed')
  const next = f.projects.records.tasks.detail('drama', report.group_id), input = next.steps[0].prompt.input
  assert.equal(input.current_script.actual_script, '最后候选稿')
  if (retryAction === 'continue') assert.deepEqual(input.review_issues, old.steps[1].result.review.issues)
  else assert.equal(input.review_issues, undefined)
  const count = f.calls.length
  const again = await f.scriptRevision.optimizeScript({ instruction: '人物改为缓慢转身', retry_of: first.group_id }, { ...f.context, source: 'ui', retryAction, requestId: 'user-retry' })
  assert.equal(again.group_id, accepted.group_id); assert.equal(f.calls.length, count)
  assert.equal(f.projects.records.tasks.detail('drama', first.group_id).status, 'rejected')
})

test('有效剧本先自动保存，审核服务失败不撤销结果或清空意见', async t => {
  const f = await fixture(t, call => { if (call.action === 'review') throw new Error('审核暂不可用'); return candidate('自动保存的剧本') })
  const report = await run(f), project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(report.status, 'failed'); assert.equal(report.saved, true); assert.equal(report.requires_user_decision, true)
  assert.deepEqual(scriptOutput(project), candidate('自动保存的剧本'))
  assert.equal(project.basic_info.script_revision_node.last_execution.status, 'failed')
})
