import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { GroupSettingService } from '../src/node_box/group_setting/service.js'
import { GenerateGroupsTool } from '../src/tools/generate_groups_tool.js'
import { ChangeRulesTool } from '../src/tools/planning_tools.js'
import { ProjectManager } from '../src/project_runtime/project_manager.js'
import { conversation as groupConversation } from '../src/node_box/group_setting/ui/conversation/index.js'
import { history as groupHistory } from '../src/node_box/group_setting/ui/conversation/history.js'
import { validateGroupCandidate } from '../src/node_box/group_setting/state.js'
import { CharacterExtractionService } from '../src/node_box/character_extraction/service.js'
import { CostumeImageService } from '../src/node_box/costume_image/service.js'
import { imageTargets } from '../src/node_box/costume_image/state.js'
import { characterOutput, validateCharacterCandidate } from '../src/node_box/character_extraction/state.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { panel } from '../src/node_box/character_extraction/ui/panel/index.js'
import { conversation } from '../src/node_box/character_extraction/ui/conversation/index.js'
import { history } from '../src/node_box/character_extraction/ui/conversation/history.js'

const passed = { status: 'passed', issues: [] }
const character = (id, costumes = []) => ({ id, name: id, social_role: '旅人', age_range: '', nationality: '', gender: '', era: '当代', height: '', body_type: '', facial_features: '', hairstyle: '', voice: '', relationships: '', signature_props: [], immutable_traits: [], group_ids: [], costumes: costumes.map(row => ({ ...row, group_id: '', group_costume_id: '', story_segment_ids: [] })) })
const candidate = () => ({ characters: [character('林舟', [{ id: 'coat', name: '外套', description: '蓝色外套' }, { id: 'shirt', name: '衬衣', description: '白色衬衣' }]), character('陈叔')] })
const teamCandidate = () => {
  const result = candidate()
  result.groups = [{ id: 'rescue', name: '救援队', social_role: '搜救', era: '当代', region: '北方寒区', appearance: '成年男女，体型各异，短发或束发，面部有风霜痕迹', demeanor: '警觉克制，站姿稳健', visual_identity: '橙色肩章，岗位标识不同', immutable_traits: [], costumes: [
    { id: 'winter', name: '冬季执勤服', description: '深蓝防水外套，橙肩章，防滑靴', story_segment_ids: ['segment_1'] },
    { id: 'summer', name: '夏季制服', description: '未选中的夏装设计', story_segment_ids: [] },
  ] }]
  result.characters[0].group_ids = ['rescue']
  Object.assign(result.characters[0].costumes[0], { group_id: 'rescue', group_costume_id: 'winter', story_segment_ids: ['segment_1'], description: '袖口有磨损，领口收紧' })
  return result
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
async function fixture(t, respond = (_body, action) => action === 'review' ? passed : candidate()) {
  const root = await mkdtemp(join(tmpdir(), 'drama-character-')), calls = []
  const mock = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks)); const image = req.url.includes('/images/')
    const action = image ? 'image' : body.messages[0].content.match(/动作：(\w+)/)[1]
    const nodeType = image ? 'costume_image' : body.messages[0].content.match(/节点：(\w+)/)[1]
    calls.push({ action, body, nodeType })
    const raw = await respond(body, action, calls, nodeType)
    const output = action === 'review' || image ? raw : nodeType === 'group_setting' ? { groups: raw.groups || [] } : { characters: raw.characters }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(image ? { data: output === null ? [] : [{ b64_json: png.toString('base64') }] } : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }))
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const projects = new ProjectService({ root, workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} }, sessionController: { create: async request => ({ sessionId: request.sessionId }) } })
  const records = createRecordService(root), models = { read: async () => ({ baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, output_language: 'zh-CN', text: { model: 'writer-test' }, image: { model: 'gpt-image' } }) }
  const groups = new GroupSettingService({ projects, records, models })
  const characters = new CharacterExtractionService({ projects, records, models }), images = new CostumeImageService({ projects, records, models })
  const handler = createProjectHttpHandler(projects, { authorize: () => null, models, groupSetting: groups, characterExtraction: characters, costumeImages: images })
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const created = await projects.create({ name: '角色测试', original_script: '林舟与陈叔在车站见面。' }, { sessionId: 'source', requestId: 'create' })
  const context = { sessionId: created.session_id, projectId: created.project_id, requestId: 'characters' }
  const file = join(root, 'projects', created.project_id, 'project.json')
  const edit = change => projects.writes.run(async () => { const value = JSON.parse(await readFile(file, 'utf8')); change(value); await writeFile(file, JSON.stringify(value)) })
  await edit(project => { project.group_setting.node_state.status = 'generated'; project.story_segments.segments = [{ id: 'segment_1', body: '林舟穿蓝色外套，换白衬衣；陈叔到达车站。' }] })
  t.after(async () => { await handler.dispose(); mock.closeAllConnections(); server.closeAllConnections(); await Promise.all([new Promise(r => mock.close(r)), new Promise(r => server.close(r))]); await rm(root, { recursive: true, force: true }) })
  const extract = async (requestId = 'characters') => { const accepted = await characters.extractCharacters({ instruction: '提取角色' }, { ...context, requestId }); return characters.waitCharacters(accepted.group_id, context.sessionId) }
  return { root, file, projects, records, models, groups, characters, images, context, calls, edit, extract, origin: `http://127.0.0.1:${server.address().port}` }
}

test('角色提取与审核保存，保留完整资料，创建服装/无服装照片槽位，幂等与隔离', async t => {
  const f = await fixture(t), report = await f.extract()
  assert.equal(report.status, 'completed'); assert.equal(report.saved, true); assert.equal(report.result_reference, '#/character_extraction/characters')
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(project.character_extraction.characters, candidate().characters)
  assert.equal(imageTargets(project).length, 3); assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0].body.messages.some(row => row.content.includes('story_outline')), true)
  assert.equal((await f.extract()).group_id, report.group_id); assert.equal(f.calls.length, 2)
  await assert.rejects(f.characters.waitCharacters(report.group_id, 'other'), { code: 'PROJECT_SCOPE' })
  await assert.rejects(f.images.generate({}, { ...f.context, sessionId: 'source' }), { code: 'PROJECT_SCOPE' })
  await f.edit(project => { project.story_segments.segments = [] })
  await assert.rejects(f.characters.extractCharacters({ instruction: '提取' }, { ...f.context, requestId: 'no-outline' }), /大纲/)
  assert.throws(() => validateCharacterCandidate({ characters: [character('same'), character('same')] }), /重复/)
})

test('一键全部生成三张定妆照，保存即完成且不请求审核，可鉴权预览和幂等重放', async t => {
  const f = await fixture(t); await f.extract()
  await f.edit(project => { project.basic_info.aspect_ratio = '16:9'; for (const asset of project.character_extraction.assets) for (const image of asset.costume_images) image.aspect_ratio = '4:3' })
  const context = { ...f.context, requestId: 'all-images' }, accepted = await f.images.generate({}, context)
  const report = await f.images.wait(accepted.group_id, context.sessionId)
  assert.equal(report.status, 'completed')
  const detail = f.records.tasks.detail(f.records.scope, accepted.group_id)
  assert.equal(detail.tasks.length, 3); assert.equal(detail.steps.length, 3)
  const project = (await f.projects.snapshot(context.sessionId)).project
  const targets = imageTargets(project)
  assert.equal(targets.filter(row => row.image.address).length, 3)
  for (const target of targets) {
    const response = await fetch(f.origin + target.image.address)
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
  }
  const reviews = f.calls.filter(row => row.action === 'review' && Array.isArray(row.body.messages.at(-1).content))
  assert.equal(reviews.length, 0)
  assert.deepEqual(f.calls.slice(2).map(row => row.action), ['image', 'image', 'image'])
  assert.ok(detail.steps.every(step => step.kind === 'generate' && step.result.saved))
  assert.ok(detail.tasks.every(task => task.metadata.input_snapshot.aspect_ratio === '3:4'))
  assert.ok(f.calls.filter(row => row.action === 'image').every(row => row.body.prompt.includes('3:4')))
  assert.ok(targets.every(row => row.image.aspect_ratio === '3:4'))
  assert.equal((await f.images.generate({}, context)).group_id, accepted.group_id)
  assert.equal(f.calls.filter(row => row.action === 'image').length, 3)
  await assert.rejects(f.images.generate({ character_id: 'other' }, context), /同一请求ID/)
  const traversal = await fetch(`${f.origin}/api/drama/costume-image?session_id=${context.sessionId}&file=..%2Fproject.json`)
  assert.equal(traversal.status, 422)
})

test('角色内容问题修订后审核；再次提取保留照片，上游变化标记过期', async t => {
  let reviewed = false
  const f = await fixture(t, (_body, action) => {
    if (action !== 'review') return candidate()
    if (!reviewed) { reviewed = true; return { status: 'content_issue', issues: [{ location: 'characters[0].name', reason: '核对姓名', suggestion: '保持原姓名' }] } }
    return passed
  })
  assert.equal((await f.extract()).status, 'completed')
  assert.deepEqual(f.calls.map(row => row.action), ['generate', 'review', 'revise', 'review'])
  const task = await f.images.generate({ character_id: '陈叔', costume_id: null }, { ...f.context, requestId: 'one-image' })
  await f.images.wait(task.group_id, f.context.sessionId)
  const before = (await f.projects.snapshot(f.context.sessionId)).project.character_extraction.assets
  await f.extract('again')
  assert.deepEqual((await f.projects.snapshot(f.context.sessionId)).project.character_extraction.assets, before)
  await f.projects.edit({ kind: 'rules', node_type: 'character_extraction', action: 'generate', field: 'supplement', value: '保留姓名', previousValue: '' }, f.context)
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.character_extraction.node_state.status, 'expired')
})

test('定妆照生图失败保留旧图片，并停止后续批次', async t => {
  let failImage = false
  const f = await fixture(t, (_body, action) => action === 'image' && failImage ? null : action === 'review' ? passed : candidate())
  await f.extract()
  const first = await f.images.generate({ character_id: '林舟', costume_id: 'coat' }, { ...f.context, requestId: 'first-image' })
  assert.equal((await f.images.wait(first.group_id, f.context.sessionId)).status, 'completed')
  const before = imageTargets((await f.projects.snapshot(f.context.sessionId)).project, '林舟', 'coat')[0].image.address
  failImage = true
  const accepted = await f.images.generate({}, { ...f.context, requestId: 'failed-images' })
  const report = await f.images.wait(accepted.group_id, f.context.sessionId)
  assert.equal(report.status, 'failed'); assert.equal(report.saved, false)
  const targets = imageTargets((await f.projects.snapshot(f.context.sessionId)).project)
  assert.equal(targets[0].image.address, before)
  assert.equal(targets.filter(row => row.image.address).length, 1)
  assert.deepEqual(f.records.tasks.detail(f.records.scope, accepted.group_id).tasks.map(task => task.task_status), ['failed', 'cancelled', 'cancelled'])
})

test('角色tab包含定妆照子盒子、一键全部和每套单张按钮，连点只提交一次', async t => {
  const f = await fixture(t); await f.extract()
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  const dom = new JSDOM('<main></main>'), previousDocument = globalThis.document; globalThis.document = dom.window.document; t.after(() => { globalThis.document = previousDocument; dom.window.close() })
  const root = dom.window.document.querySelector('main'), state = {}, calls = []; let release
  const images = { isCurrent: () => true, generate: async payload => { calls.push(payload); await new Promise(resolve => { release = resolve }); return { group_id: 'batch', status: 'queued' } }, setExecution: value => { images.execution = value } }
  const render = () => { root.replaceChildren(); panel.render(root, project, { state, characters: { repaint: render }, images }) }
  render()
  assert.equal(root.querySelectorAll('.costume-images').length, 2)
  assert.equal(root.querySelectorAll('details').length, 0)
  assert.equal(root.querySelectorAll('.character-details').length, 2)
  assert.deepEqual([...root.querySelectorAll('[data-role-module] h3')].map(row => row.textContent), ['团队设定', '人物提取', '定妆照'])
  assert.equal(root.querySelector('[data-role-module=characters] .costume-image-list'), null)
  assert.equal(root.querySelectorAll('.costume-image-list').length, 2)
  assert.equal(root.querySelectorAll('.costume-image-list')[0].children.length, 2)
  assert.equal(root.querySelectorAll('.costume-image-placeholder').length, 3)
  const batch = [...root.querySelectorAll('button')].find(row => row.textContent === '一键生成所有角色定妆照')
  batch.click(); batch.click(); assert.equal(calls.length, 1)
  assert.equal(root.querySelectorAll('.costume-images button:disabled').length, 3)
  release(); await new Promise(resolve => setImmediate(resolve))
  assert.match(root.textContent, /正在生成定妆照/)
})

test('图片生成期间角色变化，拒绝迟到结果覆盖项目；面板路由隔离并支持单角色重试', async t => {
  let f, changeDuringImage = false
  f = await fixture(t, async (_body, action) => {
    if (action === 'image' && changeDuringImage) await f.edit(project => { project.character_extraction.characters[0].facial_features = '新确认的疤痕' })
    return action === 'review' ? passed : candidate()
  })
  await f.extract(); changeDuringImage = true
  const post = async (path, data, marker = true) => fetch(`${f.origin}/api/drama/${path}?session_id=${f.context.sessionId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(marker ? { 'X-Drama-Request': '1' } : {}) }, body: JSON.stringify(data),
  })
  assert.equal((await post('costume-images', { request_id: 'no-marker' }, false)).status, 403)
  assert.equal((await post('characters', { project_id: 'other', request_id: 'other', instruction: '提取' })).status, 403)
  const accepted = await (await post('costume-images', { project_id: f.context.projectId, request_id: 'late-image', character_id: '林舟', costume_id: 'coat' })).json()
  const report = await f.images.wait(accepted.group_id, f.context.sessionId)
  assert.equal(report.status, 'failed'); assert.equal(report.saved, false)
  assert.equal(imageTargets((await f.projects.snapshot(f.context.sessionId)).project, '林舟', 'coat')[0].image.address, '')
  changeDuringImage = false
  const retry = await (await post('costume-images', { project_id: f.context.projectId, request_id: 'retry-late', retry_of: accepted.group_id, retry_action: 'regenerate' })).json()
  assert.equal((await f.images.wait(retry.group_id, f.context.sessionId)).status, 'completed')
  const tasks = f.records.tasks.detail(f.records.scope, retry.group_id).tasks
  assert.equal(tasks.length, 1); assert.equal(tasks[0].metadata.character_id, '林舟'); assert.equal(tasks[0].metadata.costume_id, 'coat')
})

test('已有定妆照重新生成只执行一次图片请求，完成后更新图片地址', async t => {
  const f = await fixture(t); await f.extract()
  await f.edit(project => { project.basic_info.aspect_ratio = '21:9'; project.character_extraction.assets[0].costume_images[0].aspect_ratio = '16:9' })
  const selection = { character_id: '林舟', costume_id: 'coat' }
  const first = await f.images.generate(selection, { ...f.context, requestId: 'first' })
  await f.images.wait(first.group_id, f.context.sessionId)
  const before = imageTargets((await f.projects.snapshot(f.context.sessionId)).project, '林舟', 'coat')[0].image.address
  const count = f.calls.length
  const second = await f.images.generate(selection, { ...f.context, requestId: 'again' })
  const report = await f.images.wait(second.group_id, f.context.sessionId)
  assert.equal(report.status, 'completed'); assert.equal(report.saved, true); assert.equal(report.requires_user_decision, false)
  assert.deepEqual(f.calls.slice(count).map(row => row.action), ['image'])
  const detail = f.records.tasks.detail(f.records.scope, second.group_id)
  assert.equal(detail.steps.length, 1); assert.equal(detail.steps[0].kind, 'revise')
  assert.equal(detail.tasks[0].metadata.input_snapshot.aspect_ratio, '3:4')
  assert.ok(f.calls.at(-1).body.prompt.includes('3:4'))
  const image = imageTargets((await f.projects.snapshot(f.context.sessionId)).project, '林舟', 'coat')[0].image
  assert.notEqual(image.address, before); assert.equal(image.node_state.status, 'generated')
})

const groupRun = async (f, requestId = 'groups') => {
  const accepted = await f.groups.generateGroups({ instruction: '设定团队形象和共同服装' }, { ...f.context, requestId })
  return f.groups.waitGroups(accepted.group_id, f.context.sessionId)
}
const portrait = f => f.projects.snapshot(f.context.sessionId).then(({project}) => imageTargets(project, '林舟', 'coat')[0].image)

test('团队与人物输出各自严格校验，旧人物投影不修改源资料', () => {
  const data = teamCandidate(), people = { characters: data.characters }, team = { groups: data.groups }, segments = [{id:'segment_1'}]
  assert.equal(validateGroupCandidate(team, {segments}).groups.length, 1)
  assert.equal(validateCharacterCandidate(people, {segments, groups:data.groups}).characters.length, 2)
  assert.throws(() => validateCharacterCandidate(data), /不允许额外字段/)
  assert.throws(() => validateGroupCandidate(data), /不允许额外字段/)
  const badGroup = change => {const v=structuredClone(team);change(v);return ()=>validateGroupCandidate(v,{segments})}
  assert.throws(badGroup(v=>v.groups.push(structuredClone(v.groups[0]))), /团队ID重复/)
  assert.throws(badGroup(v=>{v.groups[0].appearance=' '}), /appearance/)
  assert.throws(badGroup(v=>v.groups[0].costumes[0].story_segment_ids.push('missing')), /不存在的故事段/)
  const badPerson = change => {const v=structuredClone(people);change(v);return ()=>validateCharacterCandidate(v,{segments,groups:data.groups})}
  assert.throws(badPerson(v=>v.characters[0].group_ids.push('missing')), /不存在的团队/)
  assert.throws(badPerson(v=>{v.characters[0].costumes[0].group_costume_id='missing'}), /制服引用无效/)
  assert.throws(badPerson(v=>{v.characters[0].costumes[0].group_id=''}), /同时填写/)
  assert.throws(badPerson(v=>{v.characters[0].costumes[0].story_segment_ids=[]}), /超出团队制服/)
  const legacy=candidate();for(const row of legacy.characters){delete row.group_ids;for(const outfit of row.costumes){delete outfit.group_id;delete outfit.group_costume_id;delete outfit.story_segment_ids}}
  const before=structuredClone(legacy), projected=characterOutput({character_extraction:legacy})
  assert.deepEqual(projected.characters[0].group_ids,[]);assert.equal(projected.characters[0].costumes[0].group_id,'');assert.deepEqual(legacy,before)
})

test('团队会话Tool独立生成保存，人物只引用团队，图片继承选定制服并按实际关联过期', async t => {
  let output=teamCandidate()
  const f=await fixture(t,(_body,action)=>action==='review'?passed:output)
  await f.edit(project=>{project.group_setting.node_state.status='empty';project.scene_extraction.scenes=[{id:'station',name:'高寒救援站',layout:'进门左侧装备架'}]})
  await assert.rejects(f.extract(), /团队设定/)
  const tool=new GenerateGroupsTool({groupSetting:f.groups}), result=JSON.parse(await tool.execute({instruction:'设定团队形象和共同服装'},{callId:'groups-tool',agent:{session:{id:f.context.sessionId}}}))
  assert.equal(result.status,'completed');assert.equal(result.node_type,'group_setting');assert.equal(result.result_reference,'#/group_setting/groups')
  let project=(await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(project.group_setting.groups,output.groups);assert.deepEqual(project.character_extraction.characters,[])
  assert.match(JSON.stringify(f.calls[0].body.messages),/高寒救援站/)
  assert.deepEqual(f.calls.map(row=>row.nodeType),['group_setting','group_setting'])
  assert.equal((await f.extract()).status,'completed')
  project=(await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(Object.hasOwn(project.character_extraction,'groups'),false)
  assert.match(f.calls.find(row=>row.nodeType==='character_extraction').body.messages.at(-1).content, /group_setting/)
  const accepted=await f.images.generate({character_id:'林舟',costume_id:'coat'},{...f.context,requestId:'team-photo'})
  assert.equal((await f.images.wait(accepted.group_id,f.context.sessionId)).status,'completed')
  const request=f.calls.find(row=>row.action==='image').body.prompt
  assert.ok(request.includes(output.groups[0].appearance));assert.ok(request.includes(output.groups[0].costumes[0].description));assert.equal(request.includes('未选中的夏装设计'),false)
  const before=await portrait(f)
  output.groups[0].costumes[1].description='另一套夏装'
  await groupRun(f,'unselected');assert.equal((await portrait(f)).node_state.status,'generated')
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.character_extraction.node_state.status,'expired')
  await f.extract('confirm-person')
  output.groups.push({...structuredClone(output.groups[0]),id:'other',name:'其他队伍',appearance:'与林舟无关的团队形象'})
  await groupRun(f,'unrelated');assert.equal((await portrait(f)).node_state.status,'generated')
  output.groups[0].appearance='成年男女，面部有冻伤，体格各异'
  await groupRun(f,'related')
  const after=await portrait(f);assert.equal(after.address,before.address);assert.equal(after.node_state.status,'expired')
  assert.equal(f.calls.filter(row=>row.action==='image').length,1)
  const states=await f.projects.nodeStates(f.context.sessionId);assert.equal(states.nodes.group_setting.status,'generated');assert.equal(states.nodes.group_setting.last_execution.status,'completed')
})

test('空团队独立审核有效，不自动生成人物或图片，人物与团队意见和规则互不覆盖', async t => {
  const f=await fixture(t)
  await f.edit(project=>{project.group_setting.node_state.status='empty'})
  const before=(await f.projects.snapshot(f.context.sessionId)).project.character_extraction
  const report=await groupRun(f)
  assert.equal(report.status,'completed');assert.equal(report.saved,true)
  const project=(await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(project.group_setting.groups,[]);assert.deepEqual(project.character_extraction,before)
  assert.deepEqual(f.calls.map(row=>row.nodeType),['group_setting','group_setting'])
  await f.projects.edit({kind:'node_opinion',node_type:'group_setting',value:'团队意见',previousValue:''},f.context)
  await f.projects.edit({kind:'rules',node_type:'group_setting',action:'generate',field:'supplement',value:'团队补充',previousValue:''},f.context)
  const changed=(await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(changed.group_setting.node_state.opinion,'团队意见');assert.equal(changed.group_setting.node_state.rules.generate.supplement,'团队补充')
  assert.equal(changed.character_extraction.node_state.opinion,'');assert.equal(changed.character_extraction.node_state.rules.generate.supplement,'')
  assert.equal(changed.group_setting.node_state.status,'expired')
})

test('团队候选审核未通过仍保存，用户继续修改单独关联原任务；规则修复受授权约束', async t => {
  let verdict='content_issue'
  const data=teamCandidate(),f=await fixture(t,(_body,action)=>action==='review'?{status:verdict,issues:verdict==='passed'?[]:[{location:'groups[0].appearance',reason:'需要核对时代',suggestion:'保留明确依据'}]}:data)
  f.groups.maxRevisionRounds=0
  const report=await groupRun(f)
  assert.equal(report.status,'rejected');assert.equal(report.saved,true);assert.equal(report.requires_user_decision,true)
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.group_setting.node_state.status,'rejected')
  await assert.rejects(f.extract(), /团队设定/)
  verdict='passed'
  const accepted=await f.groups.generateGroups({instruction:'设定团队形象和共同服装',retry_of:report.group_id},{...f.context,requestId:'continue-group',source:'ui',retryAction:'continue'})
  const retried=await f.groups.waitGroups(accepted.group_id,f.context.sessionId)
  assert.equal(retried.status,'completed');assert.equal(retried.parent_group_id,report.group_id)
  assert.deepEqual(f.records.tasks.detail(f.records.scope,accepted.group_id).steps.map(row=>row.kind),['revise','review'])
  verdict='rule_conflict'
  const conflict=await groupRun(f,'conflict')
  assert.equal(conflict.decision,'rule_conflict')
  const state=(await f.projects.snapshot(f.context.sessionId)).project.group_setting.node_state
  const patch={action:'review',field:'supplement',value:'核对年代',previous_value:state.rules.review.supplement}
  await assert.rejects(f.groups.changeRules(patch,{sessionId:f.context.sessionId,requestId:'rules',reportId:conflict.group_id}),/授权/)
  const ruleTool=new ChangeRulesTool({projects:f.projects,records:f.records,groupSetting:f.groups})
  const changed=JSON.parse(await ruleTool.execute({report_id:conflict.group_id,...patch},{callId:'rules',agent:{session:{id:f.context.sessionId},ctx:{approval:{request:async request=>{assert.match(request.reason,/团队设定/);return 'allowed-once'}}}}}))
  assert.equal(changed.saved,true);assert.equal(changed.node_type,'group_rules')
  assert.equal(f.records.nodeTypes.some(row=>row.type==='group_rules'),true)
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.group_setting.node_state.rules.review.supplement,'核对年代')
})

test('团队内容问题自动修订并复审，upstream停止不自动修改其他盒子', async t => {
  let reviews=0,upstream=false
  const f=await fixture(t,(_body,action)=>action==='review'?(upstream?{status:'upstream_issue',issues:[{location:'story_outline',reason:'剧情缺口',suggestion:'修订大纲'}]}:reviews++===0?{status:'content_issue',issues:[{location:'groups[0].appearance',reason:'基本形象不够',suggestion:'补齐仪容'}]}:passed):teamCandidate())
  assert.equal((await groupRun(f)).status,'completed')
  assert.deepEqual(f.calls.map(row=>row.action),['generate','review','revise','review'])
  upstream=true
  const report=await groupRun(f,'upstream')
  assert.equal(report.status,'rejected');assert.deepEqual(report.related_nodes,['story_segments'])
  assert.equal(f.calls.every(row=>row.nodeType==='group_setting'),true)
})

test('团队面板路由鉴权、幂等、项目互斥及运行快照；完成后会话重放不重复模型调用', async t => {
  let release, entered
  const started=new Promise(resolve=>{entered=resolve})
  const f=await fixture(t,async(_body,action)=>{if(action==='generate'){entered();await new Promise(resolve=>{release=resolve})}return action==='review'?passed:teamCandidate()})
  const post=(value,marker=true)=>fetch(`${f.origin}/api/drama/groups?session_id=${f.context.sessionId}`,{method:'POST',headers:{'Content-Type':'application/json',...(marker?{'X-Drama-Request':'1'}:{})},body:JSON.stringify(value)})
  assert.equal((await post({request_id:'bad',instruction:'设定'},false)).status,403)
  assert.equal((await post({project_id:'other',request_id:'other',instruction:'设定'})).status,403)
  const args={project_id:f.context.projectId,request_id:'same',instruction:'设定团队'}
  const accepted=await(await post(args)).json();await started
  const snapshot=await(await fetch(`${f.origin}/api/drama/project?session_id=${f.context.sessionId}`)).json()
  assert.equal(snapshot.group_execution.group_id,accepted.group_id);assert.equal(snapshot.group_execution.status,'running')
  assert.equal((await(await post(args)).json()).group_id,accepted.group_id)
  await assert.rejects(f.characters.extractCharacters({instruction:'提取'},{...f.context,requestId:'busy-person'}),/已有.*任务/)
  await assert.rejects(f.groups.waitGroups(accepted.group_id,'other'),{code:'PROJECT_SCOPE'})
  release();assert.equal((await f.groups.waitGroups(accepted.group_id,f.context.sessionId)).status,'completed')
  assert.equal((await(await post(args)).json()).group_id,accepted.group_id);assert.equal(f.calls.length,2)
  const detail=f.records.tasks.detail(f.records.scope,accepted.group_id)
  assert.equal(detail.tasks[0].node_type,'group_setting');assert.equal(detail.tasks[0].metadata.input_snapshot.current_groups.groups.length,0)
})

test('三卡各有独立操作和loading，团队连点只提交一次，不触发人物或定妆照', async t => {
  const f=await fixture(t),project=(await f.projects.snapshot(f.context.sessionId)).project
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()})
  const root=document.querySelector('main'),state={},calls=[];let release
  const groups={isCurrent:()=>true,generate:async(...args)=>{calls.push(args);await new Promise(resolve=>{release=resolve});return{group_id:'team',status:'queued'}},setExecution:value=>{groups.execution=value}}
  const render=()=>{root.replaceChildren();panel.render(root,project,{state,groups:{...groups,repaint:render},characters:{generate:()=>assert.fail('不可自动生成人物'),isCurrent:()=>true,repaint:render}})}
  render();assert.deepEqual([...root.querySelectorAll('[data-role-module] h3')].map(row=>row.textContent),['团队设定','人物提取','定妆照'])
  const teamButton=root.querySelector('[data-node-type=group_setting] .node-ui-execution button');teamButton.click();teamButton.click()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1);assert.match(root.querySelector('[data-node-type=group_setting] [aria-live]').textContent,/正在提交团队/)
  assert.equal(root.querySelector('[data-node-type=character_extraction] .node-ui-execution button').disabled,true)
  release();await new Promise(resolve=>setImmediate(resolve));assert.match(root.querySelector('[data-node-type=group_setting] [aria-live]').textContent,/排队中/)
})

test('团队更新期间旧人物和图片结果拒绝覆盖，旧场景输入变化也拒绝团队结果', async t => {
  let f,mutate=''
  f=await fixture(t,async(_body,action,_calls,nodeType)=>{
    if(action==='image'&&mutate==='image')await f.edit(project=>{project.group_setting.groups[0].appearance='新的团队形象'})
    if(action==='revise'&&nodeType==='character_extraction'&&mutate==='person')await f.edit(project=>{project.group_setting.groups[0].appearance='再次变更的团队形象'})
    if(action==='revise'&&nodeType==='group_setting'&&mutate==='scene')await f.edit(project=>{project.scene_extraction.scenes=[{id:'new',name:'新场景'}]})
    return action==='review'?passed:teamCandidate()
  })
  await groupRun(f);await f.extract();mutate='image'
  const accepted=await f.images.generate({character_id:'林舟',costume_id:'coat'},{...f.context,requestId:'late-image'})
  const image=await f.images.wait(accepted.group_id,f.context.sessionId);assert.equal(image.status,'failed');assert.equal(image.saved,false);assert.equal((await portrait(f)).address,'')
  mutate='person';const person=await f.extract('late-person');assert.equal(person.status,'failed');assert.equal(person.saved,false)
  mutate='scene';const team=await groupRun(f,'late-team');assert.equal(team.status,'failed');assert.equal(team.saved,false)
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.group_setting.groups[0].appearance,'再次变更的团队形象')
})

test('旧合并团队资料只在读取时补独立节点，新大纲可修复旧段落引用', async t => {
  let output=teamCandidate()
  const f=await fixture(t,(_body,action)=>action==='review'?passed:output)
  await f.edit(project=>{delete project.group_setting;project.character_extraction.groups=structuredClone(output.groups)})
  const disk=await readFile(f.file,'utf8'),manager=await ProjectManager.open(f.file),legacy=manager.read()
  assert.deepEqual(legacy.group_setting.groups,output.groups);assert.equal(legacy.group_setting.node_state.status,'expired')
  assert.equal(await readFile(f.file,'utf8'),disk)
  await assert.rejects(f.extract(),/团队设定/)
  await assert.rejects(f.images.generate({},{...f.context,requestId:'legacy-image'}),/角色资料|团队设定/)
  await groupRun(f);await f.extract()
  assert.equal(Object.hasOwn((await f.projects.snapshot(f.context.sessionId)).project.character_extraction,'groups'),false)
  await f.edit(project=>{project.story_segments.segments=[{id:'segment_new',body:'救援继续'}]})
  output=teamCandidate();output.groups[0].costumes[0].story_segment_ids=['segment_new'];output.characters[0].costumes[0].story_segment_ids=['segment_new']
  assert.equal((await groupRun(f,'new-outline-team')).status,'completed')
  assert.equal((await f.extract('new-outline-person')).status,'completed')
})

test('团队与人物会话分别展示本次快照，人物输入显示团队，内部规则不透出', () => {
  const data=teamCandidate(),team={groups:data.groups},people={characters:data.characters}
  const input={story_outline:{segments:[{id:'segment_1',body:'当次故事'}]},scene_extraction:{scenes:[{id:'scene_1',name:'当次场景'}]},current_groups:team,rules:{internal:'内部规则'},instruction:'设定团队'}
  const task={task_status:'completed',metadata:{input_snapshot:input}},projected=groupHistory.inputDependencies(task)
  assert.equal(projected.rules,undefined)
  assert.deepEqual(groupHistory.taskOutput(task,[{kind:'generate',seq:1,result:{output:team}},{kind:'review',seq:2,result:{review:passed}}]).result,team)
  const dom=new JSDOM('<main/>'),body=dom.window.document.querySelector('main'),node=(tag,text)=>{const item=dom.window.document.createElement(tag);item.textContent=text;return item}
  groupConversation.renderInput(body,projected,{node});assert.ok(body.textContent.includes('当次场景'))
  body.replaceChildren();groupConversation.renderStepOutput(body,{output:team},{node});assert.ok(body.textContent.includes(data.groups[0].appearance))
  body.replaceChildren();conversation.renderInput(body,{...input,current_characters:people,group_setting:team},{node});assert.ok(body.textContent.includes('已确认团队'))
  body.replaceChildren();conversation.renderStepOutput(body,{output:people},{node});assert.equal(body.textContent.includes('团队设定'),false);assert.ok(body.textContent.includes('人物提取'));dom.window.close()
})

for (const type of ['groups','characters']) test(`${type}重新生成面板入口使用generate，修改保留revise，模式幂等且无效结果不覆盖旧资料`,async t=>{
  let invalid=false
  const f=await fixture(t,(_body,action)=>action==='review'?passed:invalid?{groups:[{bad:true}],characters:[{bad:true}]}:teamCandidate())
  await f.edit(p=>{p.group_setting.groups=teamCandidate().groups;p.group_setting.node_state.status='generated'})
  const send=(requestId,regenerate=false)=>fetch(`${f.origin}/api/drama/${type}?session_id=${f.context.sessionId}`,{method:'POST',headers:{'Content-Type':'application/json','X-Drama-Request':'1'},body:JSON.stringify({project_id:f.context.projectId,request_id:requestId,instruction:'按当前规则生成资料',regenerate})})
  const wait=id=>type==='groups'?f.groups.waitGroups(id,f.context.sessionId):f.characters.waitCharacters(id,f.context.sessionId)
  const run=async(id,flag)=>{const response=await send(id,flag);assert.equal(response.status,202);const task=await response.json();await wait(task.group_id);return f.records.tasks.detail(f.records.scope,task.group_id)}
  await run('initial',false)
  const revised=await run('revise',false);assert.equal(revised.steps[0].kind,'revise')
  const regenerated=await run('regenerate',true);assert.equal(regenerated.steps[0].kind,'generate');assert.equal(regenerated.tasks[0].metadata.regenerate,true)
  assert.equal((await send('regenerate',true)).status,202);assert.notEqual((await send('regenerate',false)).status,202)
  assert.notEqual((await send('bad-flag','true')).status,202)
  const key=type==='groups'?'group_setting':'character_extraction', field=type==='groups'?'groups':'characters'
  const before=(await f.projects.snapshot(f.context.sessionId)).project[key]
  invalid=true;const failed=await run('invalid',true)
  assert.equal(failed.status,'failed')
  const after=(await f.projects.snapshot(f.context.sessionId)).project[key]
  assert.deepEqual(after[field],before[field]);if(before.assets)assert.deepEqual(after.assets,before.assets)
})

test('角色页团队和人物各自提供重新生成，模式独立且交叉点击与前置门禁有效',async t=>{
  const f=await fixture(t),project=(await f.projects.snapshot(f.context.sessionId)).project
  project.group_setting.groups=teamCandidate().groups;project.group_setting.node_state.status='generated'
  project.character_extraction.characters=teamCandidate().characters
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=previous;dom.window.close()})
  const root=document.querySelector('main')
  for(const type of ['group_setting','character_extraction']){
    const calls=[],state={};let release
    const selected={isCurrent:()=>true,generate:(...args)=>{calls.push(args);return new Promise(resolve=>{release=resolve})},setExecution:value=>{selected.execution=value}}
    const other={isCurrent:()=>true,generate:()=>assert.fail('不能同时发起另一盒子')}
    const render=()=>{root.replaceChildren();panel.render(root,project,{state,groups:{...(type==='group_setting'?selected:other),repaint:render},characters:{...(type==='character_extraction'?selected:other),repaint:render}})}
    render()
    const opinion=root.querySelector(`[data-node-type=${type}] input`);opinion.value='只给修改使用的意见';opinion.dispatchEvent(new dom.window.Event('input'))
    const buttons=[...root.querySelectorAll(`[data-node-type=${type}] .node-ui-execution button`)]
    assert.deepEqual(buttons.map(b=>b.textContent),['重新生成','按意见修改'])
    buttons[0].click();buttons[1].click();buttons[0].click();await new Promise(resolve=>setImmediate(resolve))
    assert.equal(calls.length,1);assert.deepEqual(calls[0][2],{regenerate:true});assert.equal(calls[0][0].includes('只给修改使用的意见'),type==='group_setting');assert.equal(root.querySelector(`[data-node-type=${type}] input`).value,'只给修改使用的意见')
    assert.equal([...root.querySelectorAll('[data-node-type=group_setting] .node-ui-execution button,[data-node-type=character_extraction] .node-ui-execution button')].every(b=>b.disabled),true)
    release({group_id:type,status:'queued'});await new Promise(resolve=>setImmediate(resolve))
    assert.match(root.querySelector(`[data-node-type=${type}] [aria-live]`).textContent,/排队中/)
    selected.execution=null;render()
    const modify=[...root.querySelectorAll(`[data-node-type=${type}] .node-ui-execution button`)].find(b=>b.textContent==='按意见修改')
    modify.click();await new Promise(resolve=>setImmediate(resolve))
    assert.equal(calls.length,2);assert.equal(calls[1][0],'只给修改使用的意见');assert.equal(calls[1][2],undefined)
    release({group_id:type+'-modify',status:'queued'});await new Promise(resolve=>setImmediate(resolve))
  }
  project.group_setting.node_state.status='expired';root.replaceChildren()
  panel.render(root,project,{state:{},characters:{generate:()=>assert.fail('前置未通过不可发起'),isCurrent:()=>true}})
  assert.ok([...root.querySelectorAll('[data-node-type=character_extraction] .node-ui-execution button')].every(b=>b.disabled))
})

test('团队空结果保留完整卡片操作，仅底部普通提示取消大占位',async t=>{
  const f=await fixture(t),project=(await f.projects.snapshot(f.context.sessionId)).project
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=previous;dom.window.close()})
  const root=document.querySelector('main'),state={},calls=[]
  let execution=null
  const render=()=>{root.replaceChildren();panel.render(root,project,{state,openTasks:()=>{},openRules:()=>{},groups:{execution,isCurrent:()=>true,repaint:render,generate:async(...args)=>{calls.push(args);return{group_id:'empty-regenerate',status:'queued'}},setExecution:value=>{execution=value}}})}
  project.group_setting.node_state.status='empty';render()
  let section=root.querySelector('[data-node-type=group_setting]')
  assert.equal(section.querySelector('.node-ui-execution button').textContent,'生成团队设定')
  project.group_setting.node_state.status='generated';project.group_setting.node_state.last_execution={status:'completed'}
  render();section=root.querySelector('[data-node-type=group_setting]')
  assert.equal(section.tagName,'SECTION')
  assert.equal(section.querySelector('.production-meta').textContent,'团队提取已完成，本次未发现需要统一的团队')
  assert.equal(section.querySelector('.production-empty'),null)
  assert.equal(section.querySelector('h3').textContent,'团队设定')
  assert.equal(section.querySelector('.node-data-tag').textContent,'已生成')
  assert.equal(section.querySelector('.production-count').textContent,'0 个团队')
  assert.deepEqual([...section.querySelectorAll('.node-ui-records button')].map(b=>b.textContent),['任务历史','查看规则'])
  assert.equal(section.querySelector('.node-ui-execution button').textContent,'重新生成')
  assert.ok(section.querySelector('input'))
  assert.equal(section.classList.contains('role-module-card'),true)
  assert.ok(root.querySelector('[data-node-type=character_extraction]'))
  project.group_setting.node_state.status='expired';render();section=root.querySelector('[data-node-type=group_setting]')
  const input=section.querySelector('input');input.value='只给修改的意见';input.dispatchEvent(new dom.window.Event('input'))
  const buttons=[...section.querySelectorAll('.node-ui-execution button')]
  assert.deepEqual(buttons.map(b=>b.textContent),['重新生成'])
  buttons[0].click();buttons[0].click();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1);assert.deepEqual(calls[0][2],{regenerate:true});assert.ok(calls[0][0].includes('本次要求：只给修改的意见'))
  assert.ok(root.querySelector('[data-node-type=group_setting] .node-ui-execution button').disabled)
  project.group_setting.node_state.status='generated';execution={group_id:'new-run',status:'running'};render()
  assert.match(root.querySelector('[data-node-type=group_setting] [aria-live]').textContent,/正在执行/)
  execution=null;project.group_setting.node_state.last_execution={status:'failed',message:'模型请求失败',stop_code:'request_failed'};render()
  assert.match(root.querySelector('[data-node-type=group_setting] .node-last-execution').textContent,/模型请求失败/)
  assert.ok(root.querySelector('[data-node-type=group_setting] .node-ui-execution button'))
})

test('人物服装与其他字段同结构，序号拼接名称描述，内部引用和源数据不变',async t=>{
  const f=await fixture(t),project=(await f.projects.snapshot(f.context.sessionId)).project,value=teamCandidate()
  project.group_setting.groups=value.groups;project.character_extraction.characters=value.characters
  const first=project.character_extraction.characters[0]
  first.costumes[0].name='<img src=x onerror=alert(1)>冬装'
  first.costumes[0].description='袖口磨损，\n领口收紧。<script>不执行</script>'
  const before=structuredClone(project)
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=previous;dom.window.close()})
  const root=document.querySelector('main');panel.render(root,project,{state:{}})
  const card=root.querySelector('[data-node-type=character_extraction] > .production-card')
  const fields=card.querySelector('.character-details')
  assert.equal(card.querySelector('.character-costumes'),null)
  assert.match(fields.textContent,/\n服装：1\. .*冬装，/)
  assert.ok(fields.textContent.includes(value.groups[0].costumes[0].description));assert.ok(fields.textContent.includes('袖口磨损'))
  assert.match(fields.textContent,/；2\. /)
  const clothingLine=fields.textContent.split('\n').find(line=>line.startsWith('服装：'))
  assert.ok(clothingLine.includes('领口收紧'));assert.match(clothingLine,/；2\. /)
  assert.ok(!fields.textContent.includes('团队服装版本：'));assert.ok(!fields.textContent.includes('适用故事段：'))
  assert.equal(fields.querySelector('img,script'),null)
  assert.deepEqual(project,before)
  assert.ok(root.querySelector('[data-role-module=portraits] .costume-image-list'))
  let copied
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async text=>{copied=text}},configurable:true})
  await [...root.querySelectorAll('button')].find(button=>button.textContent==='复制人物资料').onclick()
  assert.match(copied,/服装：1\. /);assert.match(copied,/；2\. /)
  assert.equal(/\n\s*描述：/.test(copied),false)
})

test('会话人物服装同字段拼接多套名称描述，不平铺子字段或内部引用',()=>{
  const dom=new JSDOM('<main/>'),body=dom.window.document.querySelector('main')
  const node=(tag,text)=>{const el=dom.window.document.createElement(tag);el.textContent=text??'';return el}
  const value=teamCandidate(),before=structuredClone(value)
  conversation.renderStepOutput(body,{output:{characters:value.characters}},{node})
  const text=body.querySelector('pre').textContent
  assert.match(text,/服装：1\. /)
  assert.match(text,/；2\. /)
  assert.equal(/\n\s*描述：/.test(text),false)
  assert.equal(text.includes('团队服装版本：'),false);assert.equal(text.includes('适用故事段：'),false)
  assert.deepEqual(value,before);dom.window.close()
})
