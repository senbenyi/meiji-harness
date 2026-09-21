// 职责：验证项目表单、剧情总览编辑、锚点确认、镜头审看与重拍、素材筛选的页面行为。
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

const auto = { enabled: false, until_episode: null, anchors_confirmed: false, cascade_confirmed: false, paused: null, attempts: {} }
const character = (extra = {}) => ({ role: 'lin', kind: 'character', label: '林', description: '灰外套', image_prompt: 'man', image_job_id: 'a'.repeat(32), source: { type: 'job', job_id: 'a'.repeat(32) }, ...extra })
const shot = (id, extra = {}) => ({ id, roles: ['lin'], scene: 'room', shot_size: '近景', camera: '固定', action: `动作 ${id}`, duration: 5, dialogue: [{ role: 'lin', text: '你好' }],
  subtitle: '你好', prompt: '视频提示词', keyframe_prompt: 'frame', prompt_finalized: true, take: 1, keyframe_job_id: 'c'.repeat(32), job_id: 'd'.repeat(32), status: 'succeeded', ...extra })
const emptyProject = (extra = {}) => ({ id: 'abcdef12', title: '项目', director: '张艺谋', genre: '', synopsis: '', updated_at: 1, auto, materials: [], anchors: [], episodes: [], ...extra })

function fixture(initial) {
  let project = structuredClone(initial)
  const directors = [{ name: '张艺谋', display_name: '张艺谋' }, { name: '王家卫', display_name: '王家卫' }]
  const planning = { series: { versions: [], finalized: null }, episodes: {} }
  const modules = new Map(), cache = new Map(), requests = []
  runInNewContext(clientSource(), { AbortController, setTimeout, clearTimeout, window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, document: {}, URLSearchParams, URL,
    fetch: async (url, options) => {
      requests.push({ url, options })
      const body = options?.body ? JSON.parse(options.body) : null
      const reply = value => ({ ok: true, json: async () => structuredClone(value) })
      if (url.startsWith('/director/list')) return reply(directors)
      if (url.startsWith('/project/plan-read')) return reply(planning)
      if (url.startsWith('/project/plan-generate')) { planning.series.versions.push({ version: planning.series.versions.length + 1, value: { logline: '规划内容', characters: [{ id: 'lin', image_prompt: 'man' }] } }); return reply(planning) }
      if (url.startsWith('/project/plan-edit')) { planning.series.versions.push({ version: planning.series.versions.length + 1, value: body.value }); return reply(planning) }
      if (url.startsWith('/project/list')) return reply([{ id: project.id, title: project.title, status: 'todo', cover_job_id: project.cover_job_id || null, shot_count: 0, completed_count: 0, episode_count: 0, film_count: 0 }])
      if (url.startsWith('/project/create')) { project = { ...project, ...body }; return reply(project) }
      if (url.startsWith('/project/update')) project = { ...project, ...body }
      if (url.startsWith('/project/import')) project.anchors = project.anchors.map(anchor => anchor.role === body.role ? { ...anchor, source: { type: 'material', job_id: body.job_id }, image_needs_review: false } : anchor)
      if (url.startsWith('/project/anchors-confirm')) project.auto = { ...project.auto, anchors_confirmed: true }
      const episode = () => ({ ...project, episode: 1, acts: project.episodes[0]?.acts || [], deliverables: [], film_task: null })
      const shots = () => project.episodes[0].acts[0].shots
      if (url.startsWith('/project/reshoot')) { Object.assign(shots().find(item => item.id === body.shot_id), { job_id: null, keyframe_job_id: null, status: 'pending' }); return reply(episode()) }
      if (url.startsWith('/project/retry')) { shots().find(item => item.id === body.shot_id).status = 'pending'; return reply(episode()) }
      if (url.startsWith('/project/episode')) return reply(episode())
      if (url.startsWith('/media/list')) return reply({ items: [{ job_id: 'b'.repeat(32), has_image: true }], has_more: false })
      if (url.startsWith('/media/status')) return reply({ has_image: true, has_video: true, status: 'succeeded' })
      return reply(project)
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, requests, project: () => project, planning: () => planning }
}
const text = view => JSON.stringify(view.toJSON())
const find = (view, label) => view.root.findAllByType('button').find(button => button.children.join('') === label || button.props['aria-label'] === label || button.props['aria-label']?.startsWith(`${label} `))
const click = (view, label) => act(async () => find(view, label).props.onClick())
const body = (f, action) => JSON.parse(f.requests.findLast(request => request.url.startsWith(`/project/${action}`)).options.body)
async function detail(f, tab) {
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: 'abcdef12', viewState: { projectTab: tab }, back() {} })) })
  return view
}
const pickMaterial = async view => {
  await act(async () => view.root.findAllByType('button').find(button => button.props['aria-label']?.startsWith('查看素材')).props.onClick())
  await click(view, '使用此素材')
}

test('new project needs genre and synopsis, has no cover control, and opens series planning', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectList)) })
  await click(view, '新建项目')
  const submit = () => view.root.findByType('form').findAllByType('button').find(button => button.props.type === 'submit')
  assert.equal(submit().children.join(''), '创建项目')
  for (const [label, value] of [['项目名称', '新项目'], ['项目题材', '悬疑']]) await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
  assert.equal(view.root.findByProps({ 'aria-label': '项目导演' }).props.value, '张艺谋')
  assert.equal(submit().props.disabled, true)
  await act(async () => view.root.findByProps({ 'aria-label': '故事梗概' }).props.onChange({ target: { value: '旧城的一封信揭开秘密' } }))
  assert.equal(submit().props.disabled, false)
  assert.doesNotMatch(text(view), /项目封面/)
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.deepEqual(body(f, 'create'), { title: '新项目', director: '张艺谋', genre: '悬疑', synopsis: '旧城的一封信揭开秘密' })
  assert.equal(view.root.findByProps({ 'aria-label': '剧本' }).props['aria-current'], 'step')
  assert.match(text(view), /尚无规划内容/)
  await act(async () => view.unmount())
})

test('existing project persists director immediately without changing its legacy cover', async () => {
  const f = fixture(emptyProject({ genre: '悬疑', synopsis: '信', cover_job_id: 'a'.repeat(32) })), view = await detail(f, 'project')
  await act(async () => view.root.findByProps({ 'aria-label': '项目导演' }).props.onChange({ target: { value: '王家卫' } }))
  assert.equal(body(f, 'update').director, '王家卫')
  assert.equal(find(view, '更换封面图片'), undefined)
  assert.equal(f.project().cover_job_id, 'a'.repeat(32))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(f.project().cover_job_id, 'a'.repeat(32))
  await act(async () => view.unmount())
})

test('series planning is reviewed and edited through labelled fields including the English image prompt', async () => {
  const f = fixture(emptyProject({ genre: '悬疑', synopsis: '一封信' })), view = await detail(f, 'script')
  await click(view, '机器人自动生成')
  assert.equal(view.root.findByProps({ 'aria-label': '一句话梗概' }).props.value, '规划内容')
  assert.ok(view.root.findAllByType('span').some(node => node.children.join('') === '出图提示词（英文）'))
  await act(async () => view.root.findByProps({ 'aria-label': '一句话梗概' }).props.onChange({ target: { value: '手改的故事' } }))
  await click(view, '保存')
  assert.equal(body(f, 'plan-edit').value.logline, '手改的故事')
  assert.equal(f.planning().series.versions.length, 2)
  await act(async () => view.unmount())
})

test('anchors show characters with reference actions, scenes as text, and confirm only when every reference is ready', async () => {
  const project = emptyProject({ anchors: [character({ image_needs_review: true }), character({ role: 'su', label: '苏', source: null, image_job_id: null }),
    { role: 'scene-room', kind: 'scene', label: '公寓', description: '旧厨房', source: null }, character({ role: 'old', label: '旧角色', retired: true })] })
  const f = fixture(project), view = await detail(f, 'anchors')
  assert.equal(view.root.findAllByProps({ className: 'elysium-anchor-card' }).length, 3)
  assert.match(text(view), /外观已变化，参考图重新生成中/)
  assert.match(text(view), /尚未出图/)
  assert.equal(find(view, '确认锚点').props.disabled, true)
  await act(async () => view.root.findAllByType('button').filter(button => button.children.join('') === '重新生成参考图')[1].props.onClick())
  assert.deepEqual(body(f, 'anchor-generate'), { project_id: project.id, role: 'su' })
  for (const index of [0, 1]) {
    await act(async () => view.root.findAllByType('button').filter(button => button.children.join('') === '替换参考图')[index].props.onClick())
    assert.equal(new URL(f.requests.findLast(request => request.url.startsWith('/media/list')).url, 'http://localhost').searchParams.get('media_kind'), 'image')
    await pickMaterial(view)
  }
  assert.deepEqual(body(f, 'import'), { id: project.id, as: 'anchor', role: 'su', job_id: 'b'.repeat(32) })
  assert.equal(find(view, '确认锚点').props.disabled, false)
  await click(view, '确认锚点')
  assert.deepEqual(body(f, 'anchors-confirm'), { id: project.id })
  assert.equal(find(view, '确认锚点'), undefined)
  assert.match(text(view), /锚点已确认/)
  await act(async () => view.unmount())
})

test('storyboard paginates shots, previews only the selected shot and offers only reshoot and recovery', async () => {
  const shots = Array.from({ length: 40 }, (_, index) => shot(`s${index + 1}`, index === 39 ? { status: 'failed' } : {}))
  const project = emptyProject({ anchors: [character()], episodes: [{ number: 1, acts: [{ title: '第 1 集', shots }], deliverables: [], film_task: null }] })
  const f = fixture(project), view = await detail(f, 'storyboard')
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot-row' }).length, 30)
  assert.equal(f.requests.filter(request => request.url.startsWith('/media/status')).length, 0)
  await click(view, '下一页')
  await act(async () => view.root.findByProps({ 'aria-label': '镜 040' }).props.onClick())
  // 只读取所选镜头的视频与首帧状态。
  assert.deepEqual(f.requests.filter(request => request.url.startsWith('/media/status')).map(request => new URL(request.url, 'http://localhost').searchParams.get('job')), ['d'.repeat(32), 'c'.repeat(32)])
  for (const label of ['编辑镜头', '上移', '下移', '移除镜头', '添加幕', '采用此镜', '生成全部待处理镜头']) assert.equal(find(view, label), undefined, label)
  await click(view, '恢复原任务')
  assert.deepEqual(body(f, 'retry'), { project_id: project.id, episode: 1, shot_id: 's40' })
  await act(async () => view.root.findByProps({ 'aria-label': '镜 040' }).props.onClick())
  assert.equal(find(view, '重拍此镜').props.disabled, true)
  await click(view, '上一页')
  await act(async () => view.root.findByProps({ 'aria-label': '镜 001' }).props.onClick())
  assert.match(text(view), /第 1 条/)
  await click(view, '重拍此镜')
  assert.deepEqual(body(f, 'reshoot'), { project_id: project.id, episode: 1, shot_id: 's1' })
  assert.equal(f.project().episodes[0].acts[0].shots[0].job_id, null)
  assert.equal(find(view, '重拍此镜').props.disabled, true)
  await act(async () => view.unmount())
})

test('material filters reset pagination and propagate canonical quality and kind parameters', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/materials').MaterialList)) })
  await act(async () => view.root.findByProps({ 'aria-label': '创作质量' }).props.onChange({ target: { value: 'high' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '类型' }).props.onChange({ target: { value: 'image' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '每页' }).props.onChange({ target: { value: '12' } }))
  const queries = f.requests.map(request => new URL(request.url, 'https://app.test').searchParams)
  assert.equal(queries.length, 4)
  assert.ok(queries.every(query => query.get('offset') === '0'))
  assert.ok(queries.slice(0, 3).every(query => query.get('limit') === '6'))
  assert.equal(queries[3].get('limit'), '12')
  assert.equal(queries[3].get('quality'), 'high')
  assert.equal(queries[3].get('media_kind'), 'image')
  assert.equal(view.root.findAllByType('article').length, 1)
  await act(async () => view.root.findAllByType('button').find(button => button.props['aria-label']?.startsWith('查看素材')).props.onClick())
  assert.equal(find(view, '用作项目锚点'), undefined)
  await act(async () => view.unmount())
})
