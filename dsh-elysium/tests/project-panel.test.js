import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

function fixture(initial) {
  let project = initial
  const modules = new Map(), cache = new Map(), requests = []
  runInNewContext(clientSource(), { AbortController, setTimeout, clearTimeout, window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, document: {}, URLSearchParams, URL,
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (url.startsWith('/project/update')) project = { ...project, ...JSON.parse(options.body) }
      if (url.startsWith('/project/import')) {
        const body = JSON.parse(options.body)
        project = { ...project, anchors: project.anchors.map(anchor => anchor.role === body.role ? { ...anchor, source: { type: 'material', job_id: body.job_id } } : anchor) }
      }
      const result = url.startsWith('/media/list') ? { items: [{ job_id: 'b'.repeat(32), has_image: true }], has_more: false } : url.startsWith('/media/status') ? { has_image: true } : project
      return { ok: true, json: async () => structuredClone(result) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, requests, project: () => project }
}
const emptyProject = () => ({ id: 'abcdef12', title: '项目', profile: 'preview', anchors: [], acts: [], deliverables: [] })
const click = (view, text, index = 0) => act(async () => view.root.findAllByType('button').filter(button => button.children.join('') === text)[index].props.onClick())
async function edit(view, label, value) {
  const field = () => view.root.findAll(node => ['input', 'textarea'].includes(node.type) && node.props['aria-label'] === label)[0]
  await act(async () => field().props.onChange({ target: { value } }))
  await act(async () => field().props.onBlur())
}

test('anchors use explicit save, rename linked roles and only import after confirmation', async () => {
  const project = emptyProject()
  project.acts = [{ title: '幕', shots: [{ role: 'lin' }] }]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: project.id, viewState: { projectTab: 'anchors' }, back() {} })) })
  await click(view, '添加锚点')
  assert.equal(f.project().anchors.length, 0)
  for (const [label, value] of [['锚点名称', '林夏'], ['锚点描述', '米色风衣'], ['锚点角色 ID', 'lin']]) {
    await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
  }
  await click(view, '保存')
  assert.equal(f.project().anchors[0].label, '林夏')
  await click(view, '编辑锚点')
  await act(async () => view.root.findByProps({ 'aria-label': '锚点角色 ID' }).props.onChange({ target: { value: 'lin-updated' } }))
  await click(view, '保存')
  assert.equal(f.project().acts[0].shots[0].role, 'lin-updated')
  await click(view, '选择参考素材')
  await act(async () => view.root.findAllByType('button').find(x => x.props['aria-label']?.startsWith('查看素材')).props.onClick())
  assert.equal(f.requests.filter(x => x.url.startsWith('/project/import')).length, 0)
  await click(view, '使用此素材')
  assert.equal(f.project().anchors[0].source.job_id, 'b'.repeat(32))
  assert.equal(f.project().anchors[0].description, '米色风衣')
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
  await act(async () => view.root.findByProps({ 'aria-label': '搜索镜头' }).props.onChange({ target: { value: '120' } }))
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot-row' }).length, 1)
  await act(async () => view.root.findByProps({ 'aria-label': '镜 120' }).props.onClick())
  assert.equal(f.requests.filter(x => x.url.startsWith('/media/status')).length, 1)
  await click(view, '编辑镜头')
  await act(async () => view.root.findByProps({ 'aria-label': '字幕' }).props.onChange({ target: { value: '你好' } }))
  assert.equal(f.project().acts[5].shots[19].subtitle, '')
  await click(view, '保存')
  assert.equal(f.project().acts[5].shots[19].subtitle, '你好')
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
  await click(view, '交付')
  const links = view.root.findAllByType('a')
  assert.equal(links.length, 2)
  assert.equal(links[0].props.href, '/media/download?job=' + 'a'.repeat(32) + '&t=t')
  assert.equal(links[1].props.href, 'https://files.test/subtitle.srt')
  assert.match(JSON.stringify(view.toJSON()), /360秒 · 8640帧 · 31MB/)
  assert.equal(f.requests.length, 1)
  const { deliveryUrl } = f.require('elysium/delivery')
  assert.equal(deliveryUrl({ url: 'javascript:alert(1)' }), null)
  await act(async () => view.unmount())
})

test('material filters reset pagination and propagate canonical profile and kind parameters', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/materials').MaterialList)) })
  await act(async () => view.root.findByProps({ 'aria-label': '档次' }).props.onChange({ target: { value: 'high-quality' } }))
  await act(async () => view.root.findByProps({ 'aria-label': '类型' }).props.onChange({ target: { value: 'image' } }))
  const queries = f.requests.map(request => new URL(request.url, 'https://app.test').searchParams)
  assert.equal(queries.length, 3)
  assert.ok(queries.every(query => query.get('offset') === '0'))
  assert.equal(queries[2].get('profile'), 'high-quality')
  assert.equal(queries[2].get('media_kind'), 'image')
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
