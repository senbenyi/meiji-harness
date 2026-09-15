import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

function fixture({ saved = {}, media = { token: 't', base: '/media', projectBase: '/project' } } = {}) {
  const project = { id: '12345678', title: '项目', anchors: [], acts: [{ title: '幕', shots: [{ id: 'shot-1', role: '', action: '走路', subtitle: '', notes: '', mode: 't2va', job_id: null, status: 'pending' }] }], deliverables: [] }
  const modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { innerWidth: 2000, __ELYSIUM_MEDIA__: media, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, addEventListener() {}, removeEventListener() {} }, URLSearchParams, URL, AbortController, setTimeout, clearTimeout,
    document: { body: { style: {}, setAttribute() {}, removeAttribute() {} }, documentElement: { style: { setProperty() {}, removeProperty() {} } }, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }, localStorage: { getItem: () => JSON.stringify(saved), setItem() {} },
    fetch: async url => ({ ok: true, json: async () => url.startsWith('/project/list') ? [project] : url.startsWith('/project/get') ? project : { items: [], total: 0 } }) })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require }
}
test('full workbench enters project, retains selected shot across tab switch and closes', async () => {
  const f = fixture(); let view
  await act(async () => { view = create(React.createElement(f.require('elysium/workbench').Workbench)) })
  await act(async () => view.root.findByProps({ 'aria-label': '打开创作工作台' }).props.onClick())
  assert.equal(view.root.findAllByProps({ 'aria-label': '继续制作 项目' }).length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '打开项目 项目' }).props.onClick())
  assert.equal(view.root.findAllByProps({ className: 'elysium-shot-row' }).length, 1)
  await act(async () => view.root.findByProps({ 'aria-label': '镜 001' }).props.onClick())
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '素材').props.onClick())
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '项目').props.onClick())
  assert.ok(view.root.findByProps({ 'aria-label': '镜 001' }).props['aria-pressed'])
  await act(async () => view.unmount())
})

test('sidebar restored to materials survives missing service config and can close', async () => {
  const { require } = fixture({ saved: { activeTab: 'materials' }, media: null })
  let view
  await act(async () => {
    view = create(React.createElement(require('elysium/workbench').Workbench))
  })
  for (let cycle = 0; cycle < 2; cycle++) {
    await act(async () => view.root.findByProps({ 'aria-label': '打开创作工作台' }).props.onClick())
    assert.match(view.root.findByProps({ role: 'alert' }).children.join(''), /媒体服务未加载/)
    assert.equal(view.root.findByProps({ id: 'elysium-workbench-panel' }).props['aria-hidden'], false)
    await act(async () => view.root.findByProps({ 'aria-label': '收起创作工作台' }).props.onClick())
    assert.equal(view.root.findByProps({ 'aria-label': '打开创作工作台' }).props['aria-expanded'], false)
  }
  await act(async () => view.unmount())
})

test('editor keeps draft after failed save and guards navigation until discard', async () => {
  const { require } = fixture(), guard = { current: null }
  let view, saved = 0, navigated = false, closed = false
  await act(async () => { view = create(React.createElement(require('elysium/dialog').Editor, { title: '编辑', initial: { title: '原内容' }, fields: [['title', '标题']], guard, close: () => { closed = true }, save: async () => { saved++; return false } })) })
  await act(async () => view.root.findByProps({ 'aria-label': '标题' }).props.onChange({ target: { value: '草稿' } }))
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '保存').props.onClick())
  assert.equal(saved, 1); assert.equal(closed, false)
  assert.equal(view.root.findByProps({ 'aria-label': '标题' }).props.value, '草稿')
  assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 1)
  await act(async () => guard.current(() => { navigated = true }))
  assert.equal(navigated, false)
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '放弃修改').props.onClick())
  assert.equal(navigated, true); assert.equal(closed, true)
  await act(async () => view.unmount())
  assert.equal(guard.current, null)
})

test('material filter changes abort old reads and late results cannot replace current results', async () => {
  const modules = new Map(), cache = new Map(), pending = []
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: (url, options) => new Promise(resolve => pending.push({ url, signal: options.signal, resolve: value => resolve({ ok: true, json: async () => value }) })) })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/materials').MaterialList)) })
  await act(async () => view.root.findByProps({ 'aria-label': '类型' }).props.onChange({ target: { value: 'image' } }))
  assert.equal(pending[0].signal.aborted, true)
  await act(async () => pending[1].resolve({ items: [{ job_id: 'b'.repeat(32), has_image: true, title: '新结果' }], total: 1 }))
  await act(async () => pending[0].resolve({ items: [{ job_id: 'a'.repeat(32), has_video: true, title: '过期结果' }], total: 1 }))
  assert.match(JSON.stringify(view.toJSON()), /新结果/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /过期结果/)
  assert.equal(view.root.findAllByType('video').length, 0)
  await act(async () => view.unmount())
  assert.equal(pending[1].signal.aborted, true)
})

test('material list renders a playable thumbnail for video-only assets', async () => {
  const modules = new Map(), cache = new Map(), jobId = 'a'.repeat(32)
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ items: [{ job_id: jobId, has_video: true, has_image: false, title: '视频素材' }], total: 1 }) }) })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/materials').MaterialList)) })
  const video = view.root.findByType('video')
  assert.equal(video.props.src, `/media/video?job=${jobId}&t=t`)
  assert.equal(video.props.preload, 'metadata')
  assert.equal(video.props.muted, true)
  assert.equal(view.root.findAllByProps({ className: 'elysium-video-placeholder' }).length, 0)
  await act(async () => view.unmount())
})


test('director card opens edit, saves changes and create form uses save', async () => {
  const modules = new Map(), cache = new Map()
  let items = [{ name: '导演', style: '原风格', works: ['作品一', '作品二'] }], fail = true
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', directorBase: '/director' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams,
    fetch: async (url, options) => {
      if (url.includes('/update')) {
        if (fail) return { ok: false, json: async () => ({ error: '保存失败' }) }
        const value = JSON.parse(options.body); items = [value]
        return { ok: true, json: async () => value }
      }
      return { ok: true, json: async () => items }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/directors').DirectorList)) })
  await act(async () => view.root.findByProps({ className: 'elysium-director-card' }).props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '导演名称' }).props.disabled, true)
  assert.equal(view.root.findByProps({ 'aria-label': 'TOP5作品' }).props.value, '作品一\n作品二')
  await act(async () => view.root.findByProps({ 'aria-label': '导演风格' }).props.onChange({ target: { value: '新风格' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(view.root.findByProps({ role: 'alert' }).children.join(''), '保存失败')
  assert.equal(view.root.findByProps({ 'aria-label': '导演风格' }).props.value, '新风格')
  fail = false
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(view.root.findAllByType('form').length, 0)
  assert.match(JSON.stringify(view.toJSON()), /新风格/)
  await act(async () => view.root.findByProps({ 'aria-label': '添加导演' }).props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '导演名称' }).props.disabled, false)
  assert.equal(view.root.findByProps({ type: 'submit' }).children.join(''), '保存')
  await act(async () => view.unmount())
})


test('material minus confirms deletion, retains failed items and returns from an empty last page', async () => {
  const modules = new Map(), cache = new Map(), reads = [], changes = []
  let confirm = false, fail = true, deletes = 0, removed = false
  const item = { job_id: 'a'.repeat(32), has_image: true, title: '待删素材' }
  runInNewContext(clientSource(), { window: { confirm: () => confirm, __ELYSIUM_MEDIA__: { token: 't', base: '/media' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      if (url.startsWith('/media/delete')) {
        deletes++; assert.equal(options.method, 'POST')
        if (fail) return { ok: false, json: async () => ({ error: '删除失败' }) }
        removed = true; return { ok: true, json: async () => ({ deleted: true }) }
      }
      reads.push(url)
      return { ok: true, json: async () => ({ items: removed ? [{ ...item, job_id: 'b'.repeat(32), title: '保留素材' }] : [item], total: removed ? 6 : 7, has_more: false }) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const render = () => React.createElement(require('elysium/materials').MaterialList, { viewState: { page: 1 }, onViewState: value => changes.push(value) })
  let view
  await act(async () => { view = create(render()) })
  await act(async () => view.root.findByProps({ 'aria-label': '删除素材 待删素材' }).props.onClick())
  assert.equal(deletes, 0)
  confirm = true
  await act(async () => view.root.findByProps({ 'aria-label': '删除素材 待删素材' }).props.onClick())
  assert.match(view.root.findByProps({ role: 'alert' }).children.join(''), /删除失败/)
  assert.equal(view.root.findAllByProps({ 'aria-label': '查看素材 待删素材' }).length, 1)
  fail = false
  await act(async () => view.root.findByProps({ 'aria-label': '删除素材 待删素材' }).props.onClick())
  assert.equal(changes.at(-1).page, 0)
  assert.match(reads.at(-1), /offset=0/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /待删素材/)
  assert.match(JSON.stringify(view.toJSON()), /共 6 条/)
  await act(async () => view.unmount())
  await act(async () => { view = create(render()) })
  assert.equal(reads.length, 3)
  await act(async () => view.unmount())
})


test('material upload sends images and videos and refreshes the unfiltered library', async () => {
  const modules = new Map(), cache = new Map(), requests = [], uploaded = [], changes = []
  let fail = false
  runInNewContext(clientSource(), { document: { activeElement: null }, window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (url.startsWith('/media/upload')) {
        if (fail) return { ok: false, json: async () => ({ error: '导入失败' }) }
        const file = options.body
        uploaded.push({ job_id: String(uploaded.length + 1).repeat(32), title: file.name, has_image: file.name.endsWith('.png'), has_video: file.name.endsWith('.mp4') })
        return { ok: true, json: async () => uploaded.at(-1) }
      }
      return { ok: true, json: async () => ({ items: [...uploaded], total: uploaded.length, has_more: false }) }
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/materials').MaterialList, { viewState: { page: 2, profile: 'preview', media_kind: 'image', q: '旧搜索' }, onViewState: value => changes.push(value) })) })
  assert.match(view.root.findByProps({ type: 'file' }).props.accept, /\.mp4/)
  const files = [{ name: '参考.png' }, { name: '视频.mp4' }]
  const event = { target: { files, value: 'selected' } }
  await act(async () => view.root.findByProps({ type: 'file' }).props.onChange(event))
  assert.equal(event.target.value, '')
  const uploads = requests.filter(item => item.url.startsWith('/media/upload'))
  assert.equal(uploads.length, 2)
  uploads.forEach((item, index) => { assert.equal(item.options.method, 'POST'); assert.equal(item.options.body, files[index]) })
  assert.equal(changes.at(-1).page, 0); assert.equal(changes.at(-1).profile, ''); assert.equal(changes.at(-1).media_kind, '')
  assert.match(JSON.stringify(view.toJSON()), /参考.png/)
  await act(async () => view.root.findByProps({ 'aria-label': '查看素材 视频.mp4' }).props.onClick())
  assert.equal(view.root.findAllByType('button').filter(button => button.children.join('') === '用作项目锚点').length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '关闭对话框' }).props.onClick())
  fail = true
  await act(async () => view.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: '失败.png' }], value: '' } }))
  assert.match(JSON.stringify(view.toJSON()), /导入失败/)
  assert.match(JSON.stringify(view.toJSON()), /参考.png/)
  await act(async () => view.unmount())
})
