import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { testClientSource } from '../scripts/loader.js'

function fixture(initial) {
  let project = initial, directors = [
    { name: '张艺谋', style: '视觉叙事', works: ['红高粱', '活着', '英雄', '十面埋伏', '悬崖之上'] },
    { name: '王家卫', style: '都市情绪', works: ['阿飞正传', '重庆森林', '花样年华', '2046', '一代宗师'] },
  ]
  let nextShot = 0
  for (const act of project.acts) for (const shot of act.shots) shot.id ??= `shot-${++nextShot}`
  const modules = new Map(), cache = new Map(), requests = []
  runInNewContext(testClientSource(), { AbortController, setTimeout, clearTimeout, window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, document: {}, URLSearchParams, URL,
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (url.startsWith('/director/list')) return { ok: true, json: async () => structuredClone(directors) }
      if (url.startsWith('/director/create')) { const director = JSON.parse(options.body); directors = [...directors, director]; return { ok: true, json: async () => structuredClone(director) } }
      if (url.startsWith('/director/reorder')) { const { names } = JSON.parse(options.body); directors = names.map(name => directors.find(item => item.name === name)); return { ok: true, json: async () => structuredClone(directors) } }
      if (url.startsWith('/director/delete')) { const { name } = JSON.parse(options.body); directors = directors.filter(item => item.name !== name); return { ok: true, json: async () => ({ deleted: true }) } }
      if (url.startsWith('/project/list')) return { ok: true, json: async () => [{ id: project.id, title: project.title, status: 'todo', stage: 'anchors', episode_count: project.episode_count || 1, plot_summary: '咖啡馆重逢。', cover_job_id: project.cover_job_id, cover_kind: project.cover_job_id ? 'image' : null, anchor_count: project.anchors.length, shot_count: project.acts.flatMap(act => act.shots).length, completed_count: 0, deliverable_count: project.deliverables.length }] }
      if (url.startsWith('/project/create')) { project = { ...project, ...JSON.parse(options.body) }; return { ok: true, json: async () => structuredClone(project) } }
      if (url.startsWith('/project/update-anchor')) {
        const { action, data } = JSON.parse(options.body)
        if (action === 'delete') project.anchors = project.anchors.filter(anchor => anchor.role !== data.role)
        else if (action === 'add') project.anchors.push(data)
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
const emptyProject = () => ({ id: 'abcdef12', title: '项目', profile: 'preview', episode_count: 1, configuration: {}, workflow: { revision: 0, stage: 'configuration' }, episodes: [{ id: 'episode-1', title: '第 1 集', workflow: { revision: 0, stage: 'configuration' } }], anchors: [], acts: [], deliverables: [] })
const click = (view, text, index = 0) => act(async () => view.root.findAllByType('button').filter(button => button.children.join('') === text || button.props['aria-label'] === text || button.props['aria-label']?.startsWith(`${text} `))[index].props.onClick())
async function edit(view, label, value) {
  const field = () => view.root.findAll(node => ['input', 'textarea'].includes(node.type) && node.props['aria-label'] === label)[0]
  await act(async () => field().props.onChange({ target: { value } }))
  await act(async () => field().props.onBlur())
}

test('project list keeps only in-progress and completed tabs and shows unfinished work as in progress', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/project-list').ProjectList, { onSelect() {} })) })
  assert.deepEqual(view.root.findByProps({ 'aria-label': '项目状态' }).findAllByType('button').map(button => button.findByType('span').children.join('')), ['进行中', '已完成'])
  assert.ok(view.root.findByProps({ 'aria-label': '打开项目 项目' }))
  assert.equal(view.root.findByProps({ className: 'elysium-project-cover elysium-project-cover-empty' }).type, 'div')
  assert.equal(view.root.findByProps({ className: 'elysium-project-body' }).findByType('h2').children.join(''), '项目')
  assert.equal(view.root.findByProps({ className: 'elysium-project-episodes' }).children.join(''), '1 集')
  assert.equal(view.root.findByProps({ className: 'elysium-project-plot' }).children.join(''), '咖啡馆重逢。')
  await act(async () => view.root.findByProps({ 'aria-label': '项目状态' }).findAllByType('button')[1].props.onClick())
  assert.equal(view.root.findAllByProps({ 'aria-label': '打开项目 项目' }).length, 0)
  await act(async () => view.unmount())
})

test('new project opens a centered dialog with title duration ratio style and script', async () => {
  const f = fixture(emptyProject())
  let view
  let selected
  await act(async () => { view = create(React.createElement(f.require('elysium/project-list').ProjectList, { onSelect: id => { selected = id } })) })
  await click(view, '新建项目')
  assert.equal(view.root.findAllByProps({ role: 'dialog' }).length, 1)
  assert.equal(view.root.findByProps({ role: 'dialog' }).props.className, 'elysium-dialog elysium-create-project-dialog')
  assert.deepEqual(view.root.findAllByType('option')[0].children.join(''), '选择导演风格')
  assert.equal(view.root.findAllByProps({ className: 'elysium-primary' })[0].children.join(''), '创建')
  await act(async () => view.root.findByProps({ 'aria-label': '标题' }).props.onChange({ target: { value: '新项目' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '总时长' }).props.onChange({ target: { value: '8' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '画幅' }).findAllByType('button')[1].props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '风格' }).props.onChange({ target: { value: '王家卫' } }))
  await act(async () => { await view.root.findByProps({ 'aria-label': '导入剧本' }).props.onChange({ target: { files: [{ text: async () => '开场对白。' }] } }) })
  assert.equal(view.root.findByProps({ 'aria-label': '剧本' }).props.value, '开场对白。')
  assert.equal(f.requests.some(request => request.url.startsWith('/project/create')), false)
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  const body = JSON.parse(f.requests.find(request => request.url.startsWith('/project/create')).options.body)
  assert.deepEqual(body, { title: '新项目', director: '王家卫', duration_min: 8, aspect_ratio: '16:9', reference_text: '开场对白。' })
  assert.equal(f.project().director, '王家卫')
  assert.equal(selected, f.project().id)
  assert.ok(view.root.findByProps({ 'aria-label': '打开项目 新项目' }))
  await act(async () => view.unmount())
})

test('material subcategory chips reset pagination without profile or kind dropdowns', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/materials').MaterialList)) })
  assert.equal(view.root.findAllByProps({ 'aria-label': '档次' }).length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '来源' }).length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '类型' }).length, 0)
  await act(async () => view.root.findAllByType('button').find(button => button.children.join('') === '热门漫剧').props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '每页' }).props.onChange({ target: { value: '12' } }))
  const queries = f.requests.filter(request => request.url.startsWith('/media/list')).map(request => new URL(request.url, 'https://app.test').searchParams)
  assert.equal(queries.length, 3)
  assert.ok(queries.every(query => query.get('offset') === '0'))
  assert.ok(queries.slice(0, 2).every(query => query.get('limit') === '6'))
  assert.equal(queries[2].get('limit'), '12')
  assert.equal(queries[2].get('subcategory'), '热门漫剧')
  assert.equal(queries[2].get('profile'), null)
  assert.equal(queries[2].get('media_kind'), null)
  assert.equal(view.root.findAllByType('article').length, 1)
  await act(async () => view.unmount())
})

test('anchor preview retains draft after failed save and preserves reference fields', async () => {
  const project = emptyProject(), guard = { current: null }
  project.anchors = [{ role: 'lin', label: '林夏', description: '原描述', image_url: 'https://files.test/lin.png', source: null }]
  const f = fixture(project)
  let view, fail = true
  await act(async () => { view = create(React.createElement(f.require('elysium/anchors').AnchorView, { project, busy: false, guard, run: async action => fail ? false : action() })) })
  await click(view, '查看参考素材')
  assert.ok(view.root.findAllByType('img').some(img => img.props.src === 'https://files.test/lin.png'))
  await act(async () => view.root.findByProps({ 'aria-label': '锚点名称' }).props.onChange({ target: { value: '新名称' } }))
  await click(view, '保存')
  assert.match(view.root.findByProps({ role: 'alert' }).children.join(''), /保存失败/)
  assert.equal(view.root.findByProps({ 'aria-label': '锚点名称' }).props.value, '新名称')
  assert.equal(f.requests.length, 0)
  fail = false
  await click(view, '保存')
  assert.equal(view.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.equal(f.project().anchors[0].role, 'lin')
  assert.equal(f.project().anchors[0].image_url, 'https://files.test/lin.png')
  assert.equal(f.project().anchors[0].source, null)
  assert.equal(f.project().anchors[0].description, '原描述')
  await act(async () => view.unmount())
  assert.equal(guard.current, null)
})


// 更换封面只修改封面引用，不把素材变成项目锚点。
