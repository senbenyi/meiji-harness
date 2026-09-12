import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

function fixture(initial) {
  let project = initial
  const modules = new Map(), cache = new Map(), requests = []
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm: () => true }, URLSearchParams, URL,
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

test('project detail adds anchors, edits descriptions, selects materials and renames linked roles', async () => {
  const project = emptyProject()
  project.acts = [{ title: '第一幕', shots: [{ role: 'role-1' }] }]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium-tools/project').ProjectDetail, { id: 'abcdef12', back() {} })) })
  await click(view, '添加锚点')
  assert.equal(f.project().anchors.length, 1)
  await edit(view, '锚点名称', '林夏')
  await edit(view, '锚点描述', '米色风衣')
  await edit(view, '锚点角色 ID', 'lin')
  assert.equal(f.project().acts[0].shots[0].role, 'lin')
  await click(view, '从素材选择')
  await click(view, '选择')
  assert.equal(f.project().anchors[0].source.job_id, 'b'.repeat(32))
  assert.equal(f.project().anchors[0].description, '米色风衣')
  assert.equal(view.root.findByType('img').props.src, '/media/image?job=' + 'b'.repeat(32) + '&t=t')
  assert.ok(f.requests.every(request => request.url.includes('t=t')))
  await act(async () => view.unmount())
})

test('storyboard groups acts, links anchors, edits and reorders shots and distinguishes retake from replacement', async () => {
  const project = emptyProject()
  project.anchors = [{ role: 'lin', label: '林夏', description: '风衣', source: { job_id: 'b'.repeat(32) }, image_url: '' }]
  const shot = { index: 1, role: 'lin', action: 'A', subtitle: '', mode: 't2va', status: 'succeeded', job_id: 'a'.repeat(32), notes: '' }
  project.acts = [{ title: '第一幕', shots: [shot, { ...shot, action: 'B', job_id: null }] }]
  const f = fixture(project)
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium-tools/project').ProjectDetail, { id: project.id, back() {} })) })
  await click(view, '分镜')
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot-role' }).length, 2)
  assert.ok(view.root.findAllByType('img').some(image => image.props.src.includes('job=' + 'b'.repeat(32))))
  await click(view, '↓')
  assert.deepEqual(f.project().acts[0].shots.map(shot => shot.action), ['B', 'A'])
  await click(view, '重拍', 1)
  assert.equal(f.project().acts[0].shots[1].job_id, 'a'.repeat(32)); assert.equal(f.project().acts[0].shots[1].status, 'pending')
  assert.match(f.project().acts[0].shots[1].notes, /待重拍/)
  await click(view, '替换', 1)
  assert.equal(f.project().acts[0].shots[1].job_id, null)
  await edit(view, '动作描述', '转身')
  await edit(view, '字幕', '你好')
  assert.equal(f.project().acts[0].shots[0].subtitle, '你好')
  await click(view, '添加镜头')
  assert.equal(f.project().acts[0].shots.length, 3)
  await click(view, '移除')
  assert.equal(f.project().acts[0].shots.length, 2)
  await edit(view, '幕标题', '重逢')
  await act(async () => view.root.findByProps({ className: 'elysium-act-header' }).props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot' }).length, 0)
  await click(view, '添加幕')
  assert.equal(f.project().acts.length, 2)
  await click(view, '删除幕')
  assert.equal(f.project().acts.length, 1)
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
  await act(async () => { view = create(React.createElement(f.require('elysium-tools/project').ProjectDetail, { id: project.id, back() {} })) })
  await click(view, '交付')
  const links = view.root.findAllByType('a')
  assert.equal(links.length, 2)
  assert.equal(links[0].props.href, '/media/download?job=' + 'a'.repeat(32) + '&t=t')
  assert.equal(links[1].props.href, 'https://files.test/subtitle.srt')
  assert.match(JSON.stringify(view.toJSON()), /360秒 · 8640帧 · 31MB/)
  assert.equal(f.requests.length, 1)
  const { deliveryUrl } = f.require('elysium-tools/project')
  assert.equal(deliveryUrl({ url: 'javascript:alert(1)' }), null)
  await act(async () => view.unmount())
})

test('material filters reset pagination and propagate canonical profile and kind parameters', async () => {
  const f = fixture(emptyProject())
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium-tools/asset-list').MaterialList)) })
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
