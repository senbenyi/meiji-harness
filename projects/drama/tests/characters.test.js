import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { CharacterExtractionService } from '../src/node_box/character_extraction/service.js'
import { CostumeImageService } from '../src/node_box/costume_image/service.js'
import { imageTargets } from '../src/node_box/costume_image/state.js'
import { validateCharacterCandidate } from '../src/node_box/character_extraction/state.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { panel } from '../src/node_box/character_extraction/ui/panel/index.js'

const passed = { status: 'passed', issues: [] }
const character = (id, costumes = []) => ({ id, name: id, social_role: '旅人', age_range: '', nationality: '', gender: '', era: '当代', height: '', body_type: '', facial_features: '', hairstyle: '', voice: '', relationships: '', signature_props: [], immutable_traits: [], costumes })
const candidate = () => ({ characters: [character('林舟', [{ id: 'coat', name: '外套', description: '蓝色外套' }, { id: 'shirt', name: '衬衣', description: '白色衬衣' }]), character('陈叔')] })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
async function fixture(t, respond = (_body, action) => action === 'review' ? passed : candidate()) {
  const root = await mkdtemp(join(tmpdir(), 'drama-character-')), calls = []
  const mock = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks)); const image = req.url.includes('/images/')
    const action = image ? 'image' : body.messages[0].content.match(/动作：(\w+)/)[1]
    calls.push({ action, body })
    const output = await respond(body, action, calls)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(image ? { data: output === null ? [] : [{ b64_json: png.toString('base64') }] } : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }))
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const projects = new ProjectService({ root, workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} }, sessionController: { create: async request => ({ sessionId: request.sessionId }) } })
  const records = createRecordService(root), models = { read: async () => ({ baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, output_language: 'zh-CN', text: { model: 'writer-test' }, image: { model: 'gpt-image' } }) }
  const characters = new CharacterExtractionService({ projects, records, models }), images = new CostumeImageService({ projects, records, models })
  const handler = createProjectHttpHandler(projects, { authorize: () => null, models, characterExtraction: characters, costumeImages: images })
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const created = await projects.create({ name: '角色测试', original_script: '林舟与陈叔在车站见面。' }, { sessionId: 'source', requestId: 'create' })
  const context = { sessionId: created.session_id, projectId: created.project_id, requestId: 'characters' }
  const file = join(root, 'projects', created.project_id, 'project.json')
  const edit = change => projects.writes.run(async () => { const value = JSON.parse(await readFile(file, 'utf8')); change(value); await writeFile(file, JSON.stringify(value)) })
  await edit(project => { project.story_segments.segments = [{ id: 'segment_1', body: '林舟穿蓝色外套，换白衬衣；陈叔到达车站。' }] })
  t.after(async () => { await handler.dispose(); mock.closeAllConnections(); server.closeAllConnections(); await Promise.all([new Promise(r => mock.close(r)), new Promise(r => server.close(r))]); await rm(root, { recursive: true, force: true }) })
  const extract = async (requestId = 'characters') => { const accepted = await characters.extractCharacters({ instruction: '提取角色' }, { ...context, requestId }); return characters.waitCharacters(accepted.group_id, context.sessionId) }
  return { projects, records, models, characters, images, context, calls, edit, extract, origin: `http://127.0.0.1:${server.address().port}` }
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
