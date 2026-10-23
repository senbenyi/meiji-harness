import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { ProjectService } from '../src/node_box/project/service.js'
import { StorySegmentsService } from '../src/node_box/story_segments/service.js'
import { ScriptRevisionService } from '../src/node_box/script_revision/service.js'
import { GenerateStoryOutlineTool } from '../src/tools/generate_story_outline_tool.js'
import { ChangeRulesTool } from '../src/tools/planning_tools.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { storyOutput, storyFingerprint, validateStoryCandidate } from '../src/node_box/story_segments/state.js'
import { displayContext } from '../src/session/task_display_context.js'
import { taskHistoryPresentation } from '../src/client/ui/task-presentation.js'

const passed = { status: 'passed', issues: [] }
const issue = (status = 'content_issue') => ({ status, issues: [{ location: 'segments[0].body', reason: '遗漏递信动作', suggestion: '保留原动作' }] })
const candidate = (body = '林舟把信交还陈叔。') => ({ segments: [{ id: 'seg_1', title: '归还', body, world_background: '当代',
  key_anchors: [{ id: 'seg_1_anchor_001', content: '交还信件', expression: '交接动作' }], characters_and_groups: '林舟、陈叔', scene_and_space: '旧车站',
  emotion_and_rhythm: '平静释然', duration_seconds: 30, continuity: { opening: '林舟持信', ending: '陈叔收信' } }] })
async function fixture(t, response = call => call.action === 'review' ? passed : candidate(), script = '林舟在旧车站把信交还陈叔。') {
  const root = await mkdtemp(join(tmpdir(), 'drama-outline-')), calls = []
  const mock = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks)), action = body.messages.find(row => row.role === 'system').content.match(/动作：(\w+)/)[1]
      const call = { ...body, action }; calls.push(call)
      const value = await response(call, calls.length)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }))
    } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const controllers = { workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} },
    sessionController: { create: async request => ({ sessionId: request.sessionId }) } }
  const projects = new ProjectService({ root, ...controllers }), records = createRecordService(root)
  const models = { read: async () => ({ baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, output_language: 'zh-CN', text: { model: 'writer-test' } }) }
  const scripts = new ScriptRevisionService({ projects, records, models })
  const stories = new StorySegmentsService({ projects, records, models })
  const handler = createProjectHttpHandler(projects, { authorize: req => req.headers['x-test-user'] ? null : 401, models, scriptRevision: scripts, storySegments: stories })
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const created = await projects.create({ name: '测试大纲项目', original_script: script }, { sessionId: 'source', requestId: 'create' })
  const context = { sessionId: created.session_id, projectId: created.project_id, requestId: 'outline' }
  const request = (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, headers: { 'X-Test-User': '1', ...options.headers } })
  t.after(async () => { await handler.dispose(); server.closeAllConnections(); mock.closeAllConnections(); await Promise.all([new Promise(r => server.close(r)), new Promise(r => mock.close(r))]); await rm(root, { recursive: true, force: true }) })
  const file = join(root, 'projects', created.project_id, 'project.json')
  return { projects, records, stories, scripts, calls, context, request, root, controllers, file }
}
const run = async (f, instruction = '生成故事大纲') => {
  const accepted = await f.stories.generateStoryOutline({ instruction }, f.context)
  return f.stories.waitStoryOutline(accepted.group_id, f.context.sessionId)
}
const editDisk = async (f, change) => f.projects.writes.run(async () => {
  const project = JSON.parse(await readFile(f.file, 'utf8')); change(project); await writeFile(f.file, JSON.stringify(project))
})

test('会话Tool生成、审核、保存完整大纲；输入有界，记录关联，幂等与项目隔离', async t => {
  const f = await fixture(t), tool = new GenerateStoryOutlineTool({ storySegments: f.stories })
  const exec = { callId: 'outline', agent: { session: { id: f.context.sessionId } } }
  const report = JSON.parse(await tool.execute({ instruction: '生成故事大纲' }, exec))
  assert.equal(report.status, 'completed'); assert.equal(report.saved, true); assert.equal(report.result_reference, '#/story_segments/segments')
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(storyOutput(project), candidate()); assert.equal(project.story_segments.node_state.status, 'generated')
  assert.equal(project.story_segments.node_state.dependency_hash, storyFingerprint(project))
  assert.equal(project.basic_info.script_revision_node.status, 'empty', '不强制先优化')
  assert.equal(project.basic_info.actual_script, '林舟在旧车站把信交还陈叔。')
  assert.deepEqual(f.calls.map(row => [row.action, row.model]), [['generate', 'writer-test'], ['review', 'writer-test']])
  const detail = f.records.tasks.detail('drama', report.group_id)
  assert.deepEqual(detail.steps.map(step => step.kind), ['generate', 'review'])
  assert.deepEqual(detail.steps[0].prompt.input.current_outline, { segments: [] })
  assert.deepEqual(detail.steps[1].prompt.input.current_outline, candidate())
  assert.deepEqual(detail.steps[0].prompt.input.basic_info, detail.steps[1].prompt.input.basic_info)
  for (const step of detail.steps) {
    assert.deepEqual(Object.keys(step.prompt.input).sort(), ['basic_info', 'current_outline', 'instruction', 'output_language'].sort())
    assert.equal(step.http.length, 1); assert.equal(step.http[0].prompt_id, step.prompt.id)
    const row = f.records.http.read(step.http[0].id)
    assert.equal(row.ok, true); assert.deepEqual(row.params.messages, step.prompt.messages)
  }
  assert.equal((await run(f)).group_id, report.group_id); assert.equal(f.calls.length, 2)
  await assert.rejects(f.stories.generateStoryOutline({ instruction: '不同要求' }, f.context), /同一请求/)
  await assert.rejects(f.stories.generateStoryOutline({ instruction: '生成' }, { ...f.context, sessionId: 'source' }), { code: 'PROJECT_SCOPE' })
  await assert.rejects(f.stories.waitStoryOutline(report.group_id, 'source'), { code: 'PROJECT_SCOPE' })
  const output = taskHistoryPresentation.taskOutput(detail.tasks[0], detail.steps)
  assert.deepEqual(output.result, candidate())
  const input = taskHistoryPresentation.inputDependencies(detail.tasks[0], detail.steps)
  assert.deepEqual(Object.keys(input).sort(), ['basic_info', 'current_outline', 'instruction', 'output_language'].sort())
  assert.equal(Object.hasOwn(input, 'rules'), false)
  assert.deepEqual(displayContext(detail, detail.tasks[0]).final_output, candidate())
  const page = await (await f.request(`/api/drama/task-history?unit=task&project_id=${f.context.projectId}&node_type=story_segments`)).json()
  assert.equal(page.total, 1); assert.equal(page.tasks[0].id, report.task_id)
  assert.equal(project.story_segments.node_state.last_execution.stop_code, 'completed')
})

test('本地内容问题自动修订后通过，完整候选与审核意见传入；修改保留ID、消费原意见且过期下游', async t => {
  let reviews = 0, generations = 0
  const f = await fixture(t, call => call.action === 'review' ? (++reviews === 1 ? issue() : passed) : candidate(`第${++generations}稿`))
  await f.projects.edit({ kind: 'node_opinion', node_type: 'story_segments', previousValue: '', value: '补全递信' }, f.context)
  await editDisk(f, p => { p.character_extraction.node_state.status = 'generated'; p.character_extraction.characters = [{ id: 'c1', name: '林舟' }] })
  const report = await run(f, '补全递信'), detail = f.records.tasks.detail('drama', report.group_id)
  assert.equal(report.status, 'completed')
  assert.deepEqual(detail.steps.map(row => [row.kind, row.round]), [['generate',0],['review',0],['revise',1],['review',1]])
  assert.deepEqual(detail.steps[2].prompt.input.review_issues, issue().issues)
  assert.equal(detail.steps[2].prompt.input.current_outline.segments[0].body, '第1稿')
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(project.story_segments.node_state.opinion, ''); assert.equal(project.character_extraction.node_state.status, 'expired')
  assert.equal(project.character_extraction.characters[0].name, '林舟')
  f.context.requestId = 'next'
  const modified = await run(f, '继续完善')
  assert.equal(modified.status, 'completed'); assert.equal(f.records.tasks.detail('drama', modified.group_id).steps[0].kind, 'revise')
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.story_segments.segments[0].id, 'seg_1')
})

for (const status of ['rule_conflict', 'upstream_issue', 'repeated', 'limit']) test(`审核停止${status}自动保存本次有效结果，终止原因准确`, async t => {
  let reject = false, n = 0
  const f = await fixture(t, call => call.action === 'review' ? reject ? issue(status === 'limit' || status === 'repeated' ? 'content_issue' : status) : passed : candidate(reject ? status === 'repeated' ? '重复候选' : `候选${++n}` : '旧通过结果'))
  await run(f)
  const before = (await f.projects.snapshot(f.context.sessionId)).project
  reject = true; f.context.requestId = 'rejected'
  const report = await run(f), after = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(report.status, 'rejected'); assert.equal(report.saved, true)
  assert.notDeepEqual(storyOutput(after), storyOutput(before)); assert.equal(after.story_segments.node_state.status, 'rejected')
  const last = after.story_segments.node_state.last_execution
  assert.equal(last.stop_code, ['limit', 'repeated'].includes(status) ? 'content_issue' : status)
  const detail = f.records.tasks.detail('drama', report.group_id)
  if (status === 'limit') assert.equal(detail.steps.length, 8)
  if (status === 'repeated') assert.equal(detail.steps.length, 4)
  const output = taskHistoryPresentation.taskOutput(detail.tasks[0], detail.steps)
  assert.equal(output.result, null); assert.ok(output.partial_result.output.segments.length)
  assert.deepEqual(displayContext(detail, detail.tasks[0]).final_output, storyOutput(after))
})

test('空集合/重复ID/缺字段/异常响应不保存；缺剧本与非法入参不创建任务', async t => {
  const duplicate = candidate(); duplicate.segments.push(structuredClone(duplicate.segments[0]))
  const duplicateAnchor = candidate(); duplicateAnchor.segments[0].key_anchors.push({ ...duplicateAnchor.segments[0].key_anchors[0] })
  for (const value of [{ segments: [] }, duplicate, duplicateAnchor, { segments: [{ title: '缺字段' }] }, '{bad']) await t.test(JSON.stringify(value).slice(0,30), async t => {
    const f = await fixture(t, () => value), report = await run(f)
    assert.equal(report.status, 'failed'); assert.equal(report.saved, false)
    const project = (await f.projects.snapshot(f.context.sessionId)).project
    assert.deepEqual(project.story_segments.segments, []); assert.equal(project.story_segments.node_state.last_execution.stop_code, 'execution_error')
  })
  const f = await fixture(t, undefined, '')
  await assert.rejects(f.stories.generateStoryOutline({ instruction: '生成' }, f.context), /导入剧本/)
  assert.throws(() => f.stories.generateStoryOutline({ instruction: '生成', project: {} }, f.context), /只允许/)
  assert.throws(() => f.stories.generateStoryOutline({ instruction: '生成' }, {}), /sessionId/)
  assert.throws(() => f.stories.executionInput({ basic_info: {} }), /basic_info/)
  assert.equal(f.calls.length, 0)
})

test('harness-http鉴权、范围与请求标识；异步返回活动步骤，并发相同ID只提交一次', async t => {
  let entered, release
  const started = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve)
  const f = await fixture(t, async call => { if (call.action === 'generate') { entered(); await gate }; return call.action === 'review' ? passed : candidate() })
  t.after(() => release())
  const path = `/api/drama/story-outline?session_id=${f.context.sessionId}`, body = JSON.stringify({ project_id: f.context.projectId, request_id: 'outline', instruction: '生成故事大纲' })
  assert.equal((await f.request(path, { method: 'POST', body })).status, 403)
  assert.equal((await f.request(path, { method: 'POST', body, headers: { 'X-Test-User': '' } })).status, 401)
  const response = await f.request(path, { method: 'POST', body, headers: { 'X-Drama-Request': '1' } })
  assert.equal(response.status, 202); const accepted = await response.json(); await started
  const again = await f.stories.generateStoryOutline({ instruction: '生成故事大纲' }, f.context)
  assert.equal(again.group_id, accepted.group_id); assert.equal(f.calls.length, 1)
  await assert.rejects(f.stories.generateStoryOutline({ instruction: '生成' }, { ...f.context, requestId: 'other' }), { code: 'PROJECT_ACTIVE' })
  await assert.rejects(f.scripts.optimizeScript({ instruction: '优化' }, { ...f.context, requestId: 'opt' }), { code: 'PROJECT_ACTIVE' })
  const snapshot = await (await f.request(`/api/drama/project?session_id=${f.context.sessionId}`)).json()
  assert.equal(snapshot.story_execution.step.kind, 'generate')
  const states = await f.projects.nodeStates(f.context.sessionId)
  assert.equal(states.nodes.story_segments.active_execution.group_id, accepted.group_id)
  assert.doesNotMatch(JSON.stringify(states), /林舟|"rules"|"node_state_before"/)
  await assert.rejects(f.projects.edit({ kind: 'rules', node_type: 'story_segments', action: 'generate', field: 'supplement', previousValue: '', value: '新规则' }, f.context), { code: 'PROJECT_ACTIVE' })
  release(); await f.stories.waitStoryOutline(accepted.group_id, f.context.sessionId)
})

test('取消不保存迟到结果，执行期间的新意见保留，Task终态可恢复结束摘要', async t => {
  let hold = false, entered, release
  const started = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve)
  const f = await fixture(t, async call => { if (hold && call.action === 'review') { entered(); await gate }; return call.action === 'review' ? passed : candidate() })
  t.after(() => release())
  await run(f); const before = (await f.projects.snapshot(f.context.sessionId)).project
  hold = true; f.context.requestId = 'cancel'
  const accepted = await f.stories.generateStoryOutline({ instruction: '改大纲' }, f.context); await started
  await f.projects.edit({ kind: 'node_opinion', node_type: 'story_segments', previousValue: '', value: '下次意见' }, f.context)
  f.records.tasks.cancel('drama', accepted.group_id, '主动取消'); release()
  await f.records.tasks.idle('drama')
  const after = (await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(storyOutput(after), storyOutput(before)); assert.equal(after.story_segments.node_state.opinion, '下次意见')
  assert.equal(after.story_segments.node_state.last_execution.stop_code, 'cancelled')
  await editDisk(f, p => { p.story_segments.node_state.last_execution = null })
  const reopened = new ProjectService({ root: f.root, ...f.controllers }), records = createRecordService(f.root)
  reopened.enableTaskRecords(records)
  const recovered = (await reopened.snapshot(f.context.sessionId)).project
  assert.equal(recovered.story_segments.node_state.last_execution.stop_code, 'cancelled')
  await reopened.writes.run(() => {}); await records.dispose()
})

test('审核期间上游被外部改变时拒绝迟到提交；正常新意见不会被成功消费', async t => {
  for (const changed of ['script', 'opinion']) await t.test(changed, async t => {
    let entered, release
    const started = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve)
    const f = await fixture(t, async call => { if (call.action === 'review') { entered(); await gate }; return call.action === 'review' ? passed : candidate() })
    t.after(() => release())
    const accepted = await f.stories.generateStoryOutline({ instruction: '原意见' }, f.context); await started
    if (changed === 'script') await editDisk(f, p => { p.basic_info.actual_script = '外部新剧本' })
    else await f.projects.edit({ kind: 'node_opinion', node_type: 'story_segments', previousValue: '', value: '新意见' }, f.context)
    release(); const report = await f.stories.waitStoryOutline(accepted.group_id, f.context.sessionId)
    const project = (await f.projects.snapshot(f.context.sessionId)).project
    if (changed === 'script') { assert.equal(report.status, 'failed'); assert.deepEqual(storyOutput(project), candidate()) }
    else { assert.equal(report.status, 'completed'); assert.equal(project.story_segments.node_state.opinion, '新意见') }
  })
})

test('规则冲突按报告节点请求授权，拒绝不写；获准修改后关联新大纲任务，旧快照保留', async t => {
  let conflict = true
  const f = await fixture(t, call => call.action === 'review' ? conflict ? issue('rule_conflict') : passed : candidate())
  const report = await run(f), project = (await f.projects.snapshot(f.context.sessionId)).project
  await assert.rejects(f.stories.generateStoryOutline({ instruction: '生成故事大纲', retry_of: report.group_id }, { ...f.context, requestId: 'blind' }), /尚未变化/)
  const previous = project.story_segments.node_state.rules.review.base
  const changer = new ChangeRulesTool({ projects: f.projects, records: f.records, storySegments: f.stories, scriptRevision: f.scripts })
  let allowed = false, prompt
  const exec = { callId: 'rule', agent: { session: { id: f.context.sessionId }, ctx: { approval: { request: async request => { prompt = request; return allowed ? 'allowed-once' : 'denied' } } } } }
  const args = { report_id: report.group_id, action: 'review', field: 'base', previous_value: previous, value: previous + '\n明确保留递信动作。' }
  assert.equal(JSON.parse(await changer.execute(args, exec)).saved, false)
  assert.match(prompt.reason, /修改故事大纲/)
  allowed = true
  const changed = JSON.parse(await changer.execute(args, exec)); assert.equal(changed.status, 'completed')
  assert.equal(changed.result_reference, '#/story_segments/node_state/rules')
  conflict = false
  const accepted = await f.stories.generateStoryOutline({ instruction: '生成故事大纲', retry_of: report.group_id }, { ...f.context, requestId: 'repaired' })
  const next = await f.stories.waitStoryOutline(accepted.group_id, f.context.sessionId)
  assert.equal(next.status, 'completed'); assert.equal(next.parent_group_id, report.group_id)
  assert.equal(f.records.tasks.detail('drama', report.group_id).tasks[0].metadata.input_snapshot.rules.rules.review.base, previous)
  const before = (await f.projects.snapshot(f.context.sessionId)).project
  await f.projects.edit({ kind: 'rules', node_type: 'story_segments', action: 'generate', field: 'supplement', previousValue: '', value: '保留完整对白' }, f.context)
  const after = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(after.story_segments.node_state.status, 'expired'); assert.deepEqual(storyOutput(after), storyOutput(before))
  assert.equal(after.story_segments.node_state.last_execution.stop_code, 'completed')
})

test('网络失败准确记录request_failed；同工作区恢复会话仍写入同一项目且归当前会话', async t => {
  const failed = await fixture(t, () => { throw new Error('模型服务不可用') })
  const report = await run(failed)
  assert.equal(report.status, 'failed')
  assert.equal((await failed.projects.snapshot(failed.context.sessionId)).project.story_segments.node_state.last_execution.stop_code, 'request_failed')
  const f = await fixture(t), sibling = 'restored-workspace-session'
  const binding = JSON.parse(await readFile(join(f.root, 'bindings.json'), 'utf8'))
  const workspace = Object.values(binding.requests)[0].workspace
  f.projects.workspaceForSession = id => id === sibling ? { id: workspace.id, path: workspace.path, sessionIds: [sibling] } : undefined
  const accepted = await f.stories.generateStoryOutline({ instruction: '生成故事大纲' }, { ...f.context, sessionId: sibling })
  const result = await f.stories.waitStoryOutline(accepted.group_id, sibling)
  assert.equal(result.status, 'completed'); assert.equal(result.session_id, sibling)
  assert.deepEqual(storyOutput((await f.projects.snapshot(f.context.sessionId)).project), candidate())
})

test('新锚点使用所属段前缀，各段可从001开始；错误前缀、过短或全零序号及重复ID拒绝', () => {
  const output = candidate(), second = structuredClone(output.segments[0])
  second.id = 'segment_002'; second.key_anchors[0].id = 'segment_002_anchor_001'; output.segments.push(second)
  assert.deepEqual(validateStoryCandidate(output), output)
  for (const id of ['anchor_001', 'segment_other_anchor_001', 'seg_1_anchor_1', 'seg_1_anchor_000', 'seg_1_anchor_abc']) {
    const invalid = candidate(); invalid.segments[0].key_anchors[0].id = id
    assert.throws(() => validateStoryCandidate(invalid), /所属故事段前缀/)
  }
  const duplicate = structuredClone(output); duplicate.segments[1].key_anchors[0].id = duplicate.segments[0].key_anchors[0].id
  assert.throws(() => validateStoryCandidate(duplicate), /关键锚点ID重复/)
})

test('既有旧ID读取、修改和保存均保留；新增锚点仍需段前缀，不重写历史输入', async t => {
  const old = candidate('旧大纲'); old.segments[0].key_anchors[0].id = 'anchor_001'
  const modified = candidate('修改后的大纲'); modified.segments[0].key_anchors[0].id = 'anchor_001'
  modified.segments[0].key_anchors.push({ id: 'seg_1_anchor_002', content: '补充事实', expression: '' })
  assert.throws(() => validateStoryCandidate(modified), /所属故事段前缀/)
  assert.deepEqual(validateStoryCandidate(modified, { previousOutline: old }), modified)
  const invalid = structuredClone(modified); invalid.segments[0].key_anchors[1].id = 'anchor_002'
  assert.throws(() => validateStoryCandidate(invalid, { previousOutline: old }), /所属故事段前缀/)
  const f = await fixture(t, call => call.action === 'review' ? passed : modified)
  await editDisk(f, p => { p.story_segments.segments = old.segments; p.story_segments.node_state.status = 'generated' })
  const report = await run(f, '修改既有大纲')
  assert.equal(report.status, 'completed')
  assert.deepEqual(storyOutput((await f.projects.snapshot(f.context.sessionId)).project), modified)
  const detail = f.records.tasks.detail('drama', report.group_id)
  assert.deepEqual(detail.tasks[0].metadata.input_snapshot.current_outline, old)
})

for (const retryAction of ['continue', 'regenerate']) test(`内容审核未通过由用户${retryAction}，不再要求无关上游改动`, async t => {
  let allow = false
  const f = await fixture(t, call => call.action === 'review' ? allow ? passed : issue('content_issue') : candidate())
  f.stories.maxRevisionRounds = 0
  const first = await run(f)
  assert.equal(first.requires_user_decision, true)
  const old = f.records.tasks.detail('drama', first.group_id)
  assert.deepEqual(storyOutput((await f.projects.snapshot(f.context.sessionId)).project), candidate())
  await assert.rejects(f.stories.generateStoryOutline({ instruction: '生成故事大纲', retry_of: first.group_id }, { ...f.context, requestId: 'auto' }), /尚未变化/)
  await assert.rejects(f.stories.generateStoryOutline({ instruction: '生成故事大纲', retry_of: first.group_id }, { ...f.context, source: 'conversation', retryAction, requestId: 'fake' }), /需由用户/)
  allow = true
  const response = await f.request(`/api/drama/story-outline?session_id=${f.context.sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' }, body: JSON.stringify({ instruction: '生成故事大纲', retry_of: first.group_id, retry_action: retryAction, request_id: 'user-retry' }) })
  assert.equal(response.status, 202)
  const accepted = await response.json(), report = await f.stories.waitStoryOutline(accepted.group_id, f.context.sessionId)
  assert.equal(report.status, 'completed'); assert.equal(report.parent_group_id, first.group_id)
  const next = f.records.tasks.detail('drama', report.group_id), input = next.steps[0].prompt.input
  assert.equal(next.steps[0].kind, retryAction === 'continue' ? 'revise' : 'generate')
  if (retryAction === 'continue') {
    assert.deepEqual(input.current_outline, old.steps[0].result.output)
    assert.deepEqual(input.review_issues, old.steps[1].result.review.issues)
  } else {
    assert.deepEqual(input.current_outline, candidate()); assert.equal(input.review_issues, undefined)
  }
  assert.equal(f.records.tasks.detail('drama', first.group_id).status, 'rejected')
  const count = f.calls.length
  const again = await f.stories.generateStoryOutline({ instruction: '生成故事大纲', retry_of: first.group_id }, { ...f.context, requestId: 'user-retry', source: 'ui', retryAction })
  assert.equal(again.group_id, accepted.group_id); assert.equal(f.calls.length, count)
})

test('一次审核收到全部故事段，多个段的问题完整进入同一次修订', async t => {
  const output = candidate(), second = structuredClone(output.segments[0]); second.id = 'seg_2'; second.key_anchors[0].id = 'seg_2_anchor_001'; second.title = '后续'; output.segments.push(second)
  const issues = [{ location: 'seg_1.body', reason: '缺少交接', suggestion: '补足交接' }, { location: 'seg_2.continuity.opening', reason: '后段持物状态矛盾', suggestion: '同步持物状态' }]
  let reviews = 0
  const f = await fixture(t, call => call.action === 'review' ? ++reviews === 1 ? { status: 'content_issue', issues } : passed : output)
  const report = await run(f), detail = f.records.tasks.detail('drama', report.group_id)
  assert.equal(report.status, 'completed')
  const review = detail.steps.find(step => step.kind === 'review'), revise = detail.steps.find(step => step.kind === 'revise')
  assert.deepEqual(review.prompt.input.current_outline.segments.map(segment => segment.id), ['seg_1', 'seg_2'])
  assert.deepEqual(revise.prompt.input.review_issues, issues)
  const system = f.calls.find(call => call.action === 'review').messages[0].content
  assert.match(system, /全部2个故事段.*seg_1、seg_2/); assert.match(system, /发现首个问题后不得提前结束/); assert.match(system, /一次性汇总到issues/)
  assert.match(f.calls.find(call => call.action === 'revise').messages[0].content, /逐项处理review_issues中的全部问题/)
})

test('有效大纲先自动保存，随后审核网络失败仍保留结果及失败状态', async t => {
  const f = await fixture(t, call => { if (call.action === 'review') throw new Error('审核服务暂不可用'); return candidate('网络失败前已生成') })
  const report = await run(f), project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(report.status, 'failed'); assert.equal(report.saved, true); assert.equal(report.requires_user_decision, true)
  assert.deepEqual(storyOutput(project), candidate('网络失败前已生成'))
  assert.equal(project.story_segments.node_state.status, 'rejected')
  assert.equal(project.story_segments.node_state.last_execution.status, 'failed')
})
