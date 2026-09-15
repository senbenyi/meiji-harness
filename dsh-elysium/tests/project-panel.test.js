import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

function fixture(initial) {
  let project = initial, directors = [
    { name: '张艺谋', style: '视觉叙事', works: ['红高粱', '活着', '英雄', '十面埋伏', '悬崖之上'] },
    { name: '王家卫', style: '都市情绪', works: ['阿飞正传', '重庆森林', '花样年华', '2046', '一代宗师'] },
  ]
  let nextShot = 0
  for (const act of project.acts) for (const shot of act.shots) shot.id ??= `shot-${++nextShot}`
  const modules = new Map(), cache = new Map(), requests = []
  runInNewContext(clientSource(), { AbortController, setTimeout, clearTimeout, window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, document: {}, URLSearchParams, URL,
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (url.startsWith('/director/list')) return { ok: true, json: async () => structuredClone(directors) }
      if (url.startsWith('/director/create')) { const director = JSON.parse(options.body); directors = [...directors, director]; return { ok: true, json: async () => structuredClone(director) } }
      if (url.startsWith('/director/reorder')) { const { names } = JSON.parse(options.body); directors = names.map(name => directors.find(item => item.name === name)); return { ok: true, json: async () => structuredClone(directors) } }
      if (url.startsWith('/director/delete')) { const { name } = JSON.parse(options.body); directors = directors.filter(item => item.name !== name); return { ok: true, json: async () => ({ deleted: true }) } }
      if (url.startsWith('/project/list')) return { ok: true, json: async () => [{ id: project.id, title: project.title, status: 'todo', stage: 'anchors', anchor_count: project.anchors.length, shot_count: project.acts.flatMap(act => act.shots).length, completed_count: 0, deliverable_count: project.deliverables.length }] }
      if (url.startsWith('/project/create')) { project = { ...project, ...JSON.parse(options.body) }; return { ok: true, json: async () => structuredClone(project) } }
      if (url.startsWith('/project/update-anchor')) {
        const { action, data } = JSON.parse(options.body)
        if (action === 'add') project.anchors.push(data)
        else {
          project.anchors = project.anchors.map(anchor => anchor.role === data.role ? { ...anchor, ...data, role: data.new_role ?? data.role } : anchor)
          if (data.new_role) for (const act of project.acts) for (const shot of act.shots) if (shot.role === data.role) shot.role = data.new_role
        }
      } else if (url.startsWith('/project/update-shot')) {
        const { action, data } = JSON.parse(options.body)
        if (action === 'add') project.acts[data.act_index].shots.push({ id: `shot-${++nextShot}`, role: '', action: '', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' })
        else {
          const shots = project.acts.find(act => act.shots.some(shot => shot.id === data.id)).shots
          const index = shots.findIndex(shot => shot.id === data.id)
          if (action === 'update') shots[index] = { ...shots[index], ...data }
          if (action === 'delete') shots.splice(index, 1)
          if (action === 'move') [shots[index], shots[index + data.direction]] = [shots[index + data.direction], shots[index]]
        }
      } else if (url.startsWith('/project/update')) project = { ...project, ...JSON.parse(options.body) }
      if (url.startsWith('/project/import')) {
        const body = JSON.parse(options.body)
        project = { ...project, anchors: project.anchors.map(anchor => anchor.role === body.role ? { ...anchor, source: { type: 'material', job_id: body.job_id } } : anchor) }
      }
      const result = url.startsWith('/media/list') ? { items: [{ job_id: 'b'.repeat(32), has_image: true }], has_more: false } : url.startsWith('/media/status') ? { has_image: true } : project
      return { ok: true, json: async () => structuredClone(result) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, requests, project: () => project, directors: () => directors }
}
const emptyProject = () => ({ id: 'abcdef12', title: '项目', profile: 'preview', anchors: [], acts: [], deliverables: [] })
const click = (view, text, index = 0) => act(async () => view.root.findAllByType('button').filter(button => button.children.join('') === text || button.props['aria-label'] === text || button.props['aria-label']?.startsWith(`${text} `))[index].props.onClick())
async function edit(view, label, value) {
  const field = () => view.root.findAll(node => ['input', 'textarea'].includes(node.type) && node.props['aria-label'] === label)[0]
  await act(async () => field().props.onChange({ target: { value } }))
  await act(async () => field().props.onBlur())
}

test('anchors use explicit save, rename linked roles and only import after confirmation', async () => {
  const project = emptyProject()
  project.acts = [{ title: '幕', shots: [{ role: 'role-1' }] }]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: project.id, viewState: { projectTab: 'anchors' }, back() {} })) })
  await click(view, '添加锚点')
  assert.equal(view.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.equal(f.project().anchors.length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '锚点角色 ID' }).length, 0)
  for (const [label, value] of [['锚点名称', '林夏'], ['锚点描述', '米色风衣']]) {
    await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
  }
  await act(async () => view.root.findByProps({ className: 'elysium-anchor-create' }).props.onSubmit({ preventDefault() {} }))
  assert.equal(f.project().anchors[0].label, '林夏')
  assert.equal(f.project().anchors[0].role, 'role-1')
  await click(view, '编辑锚点')
  await act(async () => view.root.findByProps({ 'aria-label': '锚点角色 ID' }).props.onChange({ target: { value: 'lin-updated' } }))
  await click(view, '保存')
  assert.equal(f.project().acts[0].shots[0].role, 'lin-updated')
  assert.deepEqual(JSON.parse(f.requests.findLast(x => x.url.startsWith('/project/update-anchor')).options.body), { id: project.id, action: 'update', data: { role: 'role-1', new_role: 'lin-updated' } })
  assert.equal(view.root.findByProps({ 'aria-label': '选择参考素材 林夏' }).findByType('path').props.d, 'M12 17V3m0 0-4 4m4-4 4 4M4 15v6h16v-6')
  await click(view, '选择参考素材')
  assert.equal(view.root.findAllByProps({ 'aria-label': '类型' }).length, 0)
  assert.equal(new URL(f.requests.findLast(x => x.url.startsWith('/media/list')).url, 'http://localhost').searchParams.get('media_kind'), 'image')
  await act(async () => view.root.findAllByType('button').find(x => x.props['aria-label']?.startsWith('查看素材')).props.onClick())
  assert.equal(f.requests.filter(x => x.url.startsWith('/project/import')).length, 0)
  await click(view, '使用此素材')
  assert.equal(f.project().anchors[0].source.job_id, 'b'.repeat(32))
  assert.equal(f.project().anchors[0].description, '米色风衣')
  await click(view, '添加锚点')
  await act(async () => view.root.findByProps({ 'aria-label': '锚点名称' }).props.onChange({ target: { value: '未保存' } }))
  await click(view, '取消添加锚点')
  assert.equal(f.project().anchors.length, 1)
  await act(async () => view.unmount())
})

test('new project uses the inline production flow and advances directly to anchors', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectList)) })
  await click(view, '新建项目')
  assert.equal(view.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.deepEqual(view.root.findAllByType('button').filter(button => ['项目', '锚点', '分镜', '成品'].includes(button.props['aria-label'])).map(button => button.props['aria-label']), ['项目', '锚点', '分镜', '成品'])
  assert.equal(view.root.findAllByType('option')[0].children.join(''), '选导演')
  assert.equal(view.root.findByType('form').findAllByType('button').find(button => button.props.type === 'submit').children.join(''), '下一步')
  await act(async () => view.root.findByProps({ 'aria-label': '项目名称' }).props.onChange({ target: { value: '新项目' } }))
  assert.equal(view.root.findByType('form').findAllByType('button').find(button => button.props.type === 'submit').props.disabled, true)
  await act(async () => view.root.findByProps({ 'aria-label': '项目导演' }).props.onChange({ target: { value: '张艺谋' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(f.requests.some(request => request.url.startsWith('/project/create')), true)
  assert.equal(f.project().director, '张艺谋')
  assert.equal(view.root.findByProps({ 'aria-label': '锚点' }).props['aria-current'], 'step')
  await click(view, '返回项目')
  await act(async () => view.root.findByProps({ 'aria-label': '打开项目 新项目' }).props.onClick())
  await click(view, '项目')
  assert.equal(view.root.findByProps({ 'aria-label': '项目导演' }).props.value, '张艺谋')
  await act(async () => view.unmount())
})

test('existing project persists director immediately when leaving project settings', async () => {
  const f = fixture({ ...emptyProject(), director: '张艺谋' })
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: 'abcdef12', viewState: { projectTab: 'project' }, back() {} })) })
  await act(async () => view.root.findByProps({ 'aria-label': '项目导演' }).props.onChange({ target: { value: '王家卫' } }))
  assert.equal(f.project().director, '王家卫')
  assert.equal(JSON.parse(f.requests.findLast(request => request.url.startsWith('/project/update')).options.body).director, '王家卫')
  await act(async () => view.unmount())
})

test('director tab adds and deletes directors inline', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/directors').DirectorList)) })
  assert.equal(view.root.findAllByType('article').length, 2)
  await click(view, '添加导演')
  assert.equal(view.root.findAllByProps({ role: 'dialog' }).length, 0)
  for (const [label, value] of [['导演名称', '毕赣'], ['导演风格', '梦境与长镜头'], ['TOP5作品', '1、路边野餐  2、地球最后的夜晚 3、破碎太阳之心 4、狂野时代 5、金刚经']]) await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(f.directors().some(item => item.name === '毕赣'), true)
  assert.deepEqual(f.directors().find(item => item.name === '毕赣').works, ['路边野餐', '地球最后的夜晚', '破碎太阳之心', '狂野时代', '金刚经'])
  await act(async () => view.root.findByProps({ 'aria-label': '删除导演 毕赣' }).props.onClick({ stopPropagation() {} }))
  assert.equal(f.directors().some(item => item.name === '毕赣'), false)
  await act(async () => view.unmount())
})

test('director cards persist drag sorting', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/directors').DirectorList)) })
  let cards = view.root.findAllByType('article')
  await act(async () => cards[0].props.onDragStart({ dataTransfer: {} }))
  cards = view.root.findAllByType('article')
  await act(async () => cards[1].props.onDrop({ preventDefault() {}, clientY: 90, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) } }))
  assert.deepEqual(f.directors().map(item => item.name), ['王家卫', '张艺谋'])
  assert.equal(f.requests.some(request => request.url.startsWith('/director/reorder')), true)
  await act(async () => view.unmount())
})

test('storyboard paginates 120 shots, requests only selected preview and saves explicit edits', async () => {
  const project = emptyProject()
  project.anchors = [{ role: 'lin', label: '林', description: '', image_url: 'https://files.test/lin.png' }]
  project.acts = Array.from({ length: 6 }, (_, a) => ({ title: `幕${a}`, shots: Array.from({ length: 20 }, (_, i) => ({ index: a * 20 + i + 1, role: 'lin', action: `动作${a}-${i}`, subtitle: '', mode: 't2va', job_id: 'a'.repeat(32), status: 'succeeded', notes: '' })) }))
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: project.id, viewState: { projectTab: 'anchors' }, back() {} })) })
  await click(view, '分镜')
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot-row' }).length, 30)
  assert.equal(f.requests.filter(x => x.url.startsWith('/media/status')).length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '搜索镜头' }).length, 0)
  for (let page = 0; page < 3; page++) await click(view, '下一页')
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot-row' }).length, 30)
  await act(async () => view.root.findByProps({ 'aria-label': '镜 120' }).props.onClick())
  assert.equal(f.requests.filter(x => x.url.startsWith('/media/status')).length, 1)
  await click(view, '编辑镜头')
  await act(async () => view.root.findByProps({ 'aria-label': '字幕' }).props.onChange({ target: { value: '你好' } }))
  assert.equal(f.project().acts[5].shots[19].subtitle, '')
  await click(view, '保存')
  assert.equal(f.project().acts[5].shots[19].subtitle, '你好')
  assert.deepEqual(JSON.parse(f.requests.findLast(x => x.url.startsWith('/project/update-shot')).options.body), { id: project.id, action: 'update', data: { id: 'shot-120', subtitle: '你好' } })
  await click(view, '标记待重拍')
  assert.equal(f.project().acts[5].shots[19].job_id, 'a'.repeat(32))
  assert.equal(f.project().acts[5].shots[19].status, 'pending')
  await click(view, '解除素材关联')
  assert.equal(f.project().acts[5].shots[19].job_id, null)
  await act(async () => view.unmount())
})

test('delivery view renders film specs and server subtitle links without fetching media', async () => {
  const project = emptyProject()
  project.deliverables = [
    { type: 'film', label: '六分钟预览', job_id: 'a'.repeat(32), duration_sec: 360, frame_count: 8640, size_bytes: 31 * 1024 * 1024 },
    { type: 'subtitle', label: '字幕 SRT', url: 'https://files.test/subtitle.srt' },
    { type: 'film', label: '旧本地路径', path: 'out/movie.mp4' },
  ]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: project.id, viewState: { projectTab: 'anchors' }, back() {} })) })
  await click(view, '成品')
  const links = view.root.findAllByType('a')
  assert.equal(links.length, 1)
  assert.equal(view.root.findByType('video').props.src, '/media/video?job=' + 'a'.repeat(32) + '&t=t')
  assert.equal(links[0].props['aria-label'], '下载字幕 字幕 SRT')
  assert.equal(links[0].props.href, 'https://files.test/subtitle.srt')
  assert.equal(view.root.findByType('video').props.controls, true)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /播放成片|下载视频/)
  assert.match(JSON.stringify(view.toJSON()), /360秒 · 8640帧 · 31MB/)
  assert.equal(f.requests.length, 1)
  const { deliveryUrl } = f.require('elysium/delivery')
  assert.equal(deliveryUrl({ url: 'javascript:alert(1)' }), null)
  await act(async () => view.unmount())
})

test('panel adds, moves and deletes by shot ID while retaining selection after reorder', async () => {
  const project = emptyProject()
  project.acts = [{ title: '幕', shots: [] }]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: project.id, viewState: { projectTab: 'acts' }, back() {} })) })
  await click(view, '添加镜头')
  await click(view, '添加镜头')
  const second = f.project().acts[0].shots[1].id
  await click(view, '上移')
  assert.equal(f.project().acts[0].shots[0].id, second)
  assert.equal(view.root.findByProps({ 'aria-label': '镜 001' }).props['aria-pressed'], true)
  await click(view, '移除镜头')
  assert.equal(f.project().acts[0].shots.length, 1)
  const requests = f.requests.filter(x => x.url.startsWith('/project/update-shot')).map(x => JSON.parse(x.options.body))
  assert.deepEqual(requests.map(x => x.action), ['add', 'add', 'move', 'delete'])
  assert.deepEqual(requests[2].data, { id: second, direction: -1 })
  assert.deepEqual(requests[3].data, { id: second })
  assert.equal(f.requests.some(x => x.url.startsWith('/project/update?')), false)
  await act(async () => view.unmount())
})

test('material filters reset pagination and propagate canonical profile and kind parameters', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/materials').MaterialList)) })
  await act(async () => view.root.findByProps({ 'aria-label': '档次' }).props.onChange({ target: { value: 'high-quality' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '类型' }).props.onChange({ target: { value: 'image' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '每页' }).props.onChange({ target: { value: '12' } }))
  const queries = f.requests.map(request => new URL(request.url, 'https://app.test').searchParams)
  assert.equal(queries.length, 4)
  assert.ok(queries.every(query => query.get('offset') === '0'))
  assert.ok(queries.slice(0, 3).every(query => query.get('limit') === '6'))
  assert.equal(queries[3].get('limit'), '12')
  assert.equal(queries[3].get('profile'), 'high-quality')
  assert.equal(queries[3].get('media_kind'), 'image')
  assert.equal(view.root.findAllByType('article').length, 1)
  await act(async () => view.unmount())
})

test('anchor image takes precedence over source video and storyboard does not fetch anchor previews', async () => {
  const project = emptyProject()
  project.anchors = [{ role: 'lin', label: '林', description: '', source: { job_id: 'b'.repeat(32) }, image_url: 'https://files.test/lin.png' }]
  project.acts = [{ title: '幕', shots: [{ role: 'lin', action: '', subtitle: '', mode: 'i2va', job_id: null, status: 'pending', notes: '' }] }]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: project.id, viewState: { projectTab: 'anchors' }, back() {} })) })
  assert.equal(view.root.findByType('img').props.src, 'https://files.test/lin.png')
  await click(view, '分镜')
  assert.equal(f.requests.filter(x => x.url.startsWith('/media/status')).length, 0)
  await act(async () => view.unmount())
})

test('job-backed local anchor previews use authenticated image routes', async () => {
  const project = emptyProject()
  project.anchors = [{ role:'lin', label:'林夏', description:'', source:{type:'job',job_id:'b'.repeat(32)}, image_url:'' }]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/anchors').AnchorView,{project,save(){},run(){}})) })
  assert.equal(view.root.findByType('img').props.src,`/media/image?job=${'b'.repeat(32)}&t=t`)
  assert.equal(f.requests.filter(request => request.url.startsWith('/media/status')).length,1)
  await act(async () => view.unmount())
})


test('delivery uses native controls, allows film selection and handles subtitle-only projects', async () => {
  const project = emptyProject(), f = fixture(project)
  project.deliverables = [
    { type:'subtitle', label:'字幕', url:'https://files.test/subtitle.srt' },
    { type:'film', label:'无效成片', url:'file:///movie.mp4' },
    { type:'film', label:'第一版', job_id:'a'.repeat(32) },
    { type:'film', label:'第二版', url:'https://files.test/film.mp4' },
  ]
  const Component = f.require('elysium/delivery').DeliveryView
  let view
  await act(async () => { view = create(React.createElement(Component, { project })) })
  assert.equal(view.root.findByType('video').props.src,'/media/video?job='+'a'.repeat(32)+'&t=t')
  assert.equal(view.root.findByType('video').props.controls,true)
  assert.equal(view.root.findByType('video').props.autoPlay,undefined)
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/播放成片|下载视频/)
  await act(async () => view.root.findByProps({ 'aria-label':'选择成片' }).props.onChange({ target:{value:'https://files.test/film.mp4'} }))
  assert.equal(view.root.findByType('video').props.src,'https://files.test/film.mp4')
  await act(async () => view.update(React.createElement(Component, { project:{...project,deliverables:[project.deliverables[0]]} })))
  assert.equal(view.root.findAllByType('video').length,0)
  assert.match(JSON.stringify(view.toJSON()),/暂无可预览成片/)
  assert.equal(view.root.findByType('a').props.href,'https://files.test/subtitle.srt')
  await act(async () => view.unmount())
})
