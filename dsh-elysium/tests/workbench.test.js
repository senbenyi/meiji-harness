import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { initialProduction, materialValues } from '../src/database/schemas/production.js'
import { clientSource, testClientSource } from '../scripts/loader.js'

function fixture({ saved = {}, width = 2000, media = { token: 't', base: '/media', projectBase: '/project' }, requests = [], status = { has_video: true } } = {}) {
  const project = { id: '12345678', title: '项目', workflow: { revision: 0, stage: 'storyboard' }, episodes: [{ id: 'episode-1', title: '第 1 集', workflow: { revision: 0, stage: 'storyboard', plot: '故事', storyboard_revision: 0 } }], anchors: [], acts: [{ episode_id: 'episode-1', title: '幕', shots: [{ id: 'shot-1', role: '', action: '走路', subtitle: '', notes: '', mode: 't2va', job_id: null, status: 'pending' }] }], deliverables: [] }
  project.production = { ...initialProduction(project), story: { scenes: [{ id: 'scene-a', title: '场景', description: '故事', duration: 5 }] }, segments: [{ id: 'segment-a', scene_id: 'scene-a', title: '片段', duration: 5, description: '故事', revision: 0, shots_revision: 0, materials: materialValues(), shots: [{ id: 'shot-a', start: 0, duration: 5, action: '走路' }], inputs: [], generations: [] }] }
  const modules = new Map(), cache = new Map()
  const listeners = new Map(), properties = new Map(), storage = { saved }
  const browser = { innerWidth: width, __ELYSIUM_MEDIA__: media, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  runInNewContext(clientSource(), { window: browser, URLSearchParams, URL, AbortController, structuredClone, setTimeout, clearTimeout,
    document: { body: { style: {}, setAttribute() {}, removeAttribute() {} }, documentElement: { style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) } }, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }, localStorage: { getItem: () => JSON.stringify(storage.saved), setItem: (key, value) => { storage.saved = JSON.parse(value) } },
    fetch: async url => { requests.push(url); return { ok: true, json: async () => url.startsWith('/project/list') ? [project] : url.startsWith('/project/get') ? project : url.startsWith('/media/status') ? status
      : url.startsWith('/settings/models') ? { revision: 0, models: { image: [], video: [] }, selected: { image: '', video: '' } } : { items: [], total: 0 } } } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  cache.set('elysium/project-generation', { ...require('elysium/project-generation'), selectProject: async id => id, watchSession: () => () => {} })
  return { require, browser, listeners, properties, storage }
}
test('material browser and image picker share category tabs and reset pagination on switch', async () => {
  for (const imageOnly of [false, true]) {
    const requests = [], changes = [], f = fixture({ requests }); let view
    await act(async () => { view = create(React.createElement(f.require('elysium/materials').MaterialList, { imageOnly, viewState: { page: 2 }, onViewState: value => changes.push(value) })) })
    assert.deepEqual(view.root.findAllByProps({ role: 'tab' }).map(tab => tab.children.join('')), imageOnly ? ['人物', '场景', '道具'] : ['人物', '场景', '道具', '题材', '音乐', '视频', '导演'])
    assert.equal(new URL(requests.at(-1), 'https://test').searchParams.get('category'), 'character')
    for (const [category, label] of [['scene', '场景'], ['prop', '道具']]) {
      await act(async () => view.root.findAllByProps({ role: 'tab' }).find(tab => tab.children.join('') === label).props.onClick())
      const query = new URL(requests.at(-1), 'https://test').searchParams
      assert.equal(query.get('category'), category); assert.equal(query.get('offset'), '0')
      if (imageOnly) assert.equal(query.get('media_kind'), 'image')
      assert.equal(changes.at(-1).category, category); assert.equal(changes.at(-1).page, 0)
    }
    assert.equal(view.root.findAllByProps({ 'aria-label': '档次' }).length, 0)
    assert.equal(view.root.findAllByProps({ 'aria-label': '来源' }).length, 0)
    assert.equal(view.root.findAllByProps({ 'aria-label': '类型' }).length, 0)
    if (!imageOnly) {
      await act(async () => view.root.findAllByProps({ role: 'tab' }).find(tab => tab.children.join('') === '题材').props.onClick())
      assert.equal(new URL(requests.at(-1), 'https://test').searchParams.get('category'), 'theme')
      assert.ok(view.root.findByProps({ className: 'elysium-theme-grid' }))
      assert.ok(view.root.findByProps({ 'aria-label': '新建题材' }))
    }
    await act(async () => view.unmount())
  }
})

test('workbench video previews load only after explicit playback', async () => {
  const f = fixture(), jobId = 'a'.repeat(32)
  let shot, delivery
  await act(async () => { shot = create(React.createElement(f.require('elysium/shot-preview').ShotPreview, { jobId })) })
  assert.equal(shot.root.findAllByType('video').length, 0)
  await act(async () => shot.root.findByProps({ 'aria-label': '播放镜头视频' }).props.onClick())
  assert.equal(shot.root.findAllByType('video').length, 1)
  await act(async () => shot.unmount())

  const modules = new Map(), cache = new Map()
  runInNewContext(testClientSource(), { window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media' }, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } }, URLSearchParams, URL, AbortController, setTimeout, clearTimeout })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const project = { acts: [], deliverables: [{ type: 'film', label: '成片', job_id: jobId }] }
  await act(async () => { delivery = create(React.createElement(require('elysium/delivery').DeliveryView, { project })) })
  assert.equal(delivery.root.findAllByType('video').length, 0)
  await act(async () => delivery.root.findByProps({ 'aria-label': '播放成片 成片' }).props.onClick())
  assert.equal(delivery.root.findAllByType('video').length, 1)
  await act(async () => delivery.unmount())
})
test('permanent workbench enters project and retains selected shot across tab switch', async () => {
  const f = fixture(); let view
  await act(async () => { view = create(React.createElement(f.require('elysium/workbench').Workbench)) })
  assert.equal(view.root.findAllByProps({ 'aria-label': '继续制作 项目' }).length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '打开项目 项目' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '打开片段分镜 1' }).props.onClick())
  assert.equal(view.root.findAllByProps({ 'aria-label': '打开分镜 1' }).length, 1)
  await act(async () => view.root.findByProps({ 'aria-label': '打开分镜 1' }).props.onClick())
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '素材').props.onClick())
  await act(async () => view.root.findAllByType('button').find(x => x.children.join('') === '项目').props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '画面动作' }).props.value, '走路')
  await act(async () => view.unmount())
})

test('permanent workbench restored to materials survives missing service config', async () => {
  const { require } = fixture({ saved: { activeTab: 'materials' }, media: null })
  let view
  await act(async () => {
    view = create(React.createElement(require('elysium/workbench').Workbench))
  })
  assert.match(view.root.findByProps({ role: 'alert' }).children.join(''), /媒体服务未加载/)
  assert.notEqual(view.root.findByProps({ id: 'elysium-workbench-panel' }).props['aria-hidden'], true)
  assert.equal(view.root.findByProps({ id: 'elysium-workbench-panel' }).props.onKeyDown, undefined)
  assert.equal(view.root.findAllByProps({ 'aria-label': '收起创作工作台' }).length, 0)
  await act(async () => view.unmount())
})

test('left workbench resizes in the drag direction, persists width and reserves chat space', async () => {
  const f = fixture({ width: 1200 }); let view
  const render = () => React.createElement(f.require('elysium/workbench').Workbench)
  const handle = () => view.root.findByProps({ 'aria-label': '调整项目列表宽度' })
  const pointer = { pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } }
  await act(async () => { view = create(render()) })
  assert.equal(f.properties.get('--elysium-list-width'), '250px')
  await act(async () => handle().props.onPointerDown(pointer))
  await act(async () => handle().props.onPointerMove({ ...pointer, clientX: 400 }))
  await act(async () => handle().props.onPointerUp(pointer))
  assert.equal(f.properties.get('--elysium-list-width'), '344px')
  assert.equal(f.storage.saved.leftWidth, 344)
  await act(async () => view.unmount())
  assert.equal(f.properties.has('--elysium-list-width'), false)
  await act(async () => { view = create(render()) })
  assert.equal(f.properties.get('--elysium-list-width'), '344px')
  await act(async () => handle().props.onPointerDown(pointer))
  await act(async () => handle().props.onPointerMove({ ...pointer, clientX: 890 }))
  await act(async () => handle().props.onPointerUp(pointer))
  assert.equal(f.properties.get('--elysium-list-width'), '444px')
  await act(async () => { f.browser.innerWidth = 390; f.listeners.get('resize')() })
  assert.equal(f.properties.get('--elysium-list-width'), '0px')
  assert.equal(view.root.findAllByProps({ role: 'separator' }).length, 0)
  await act(async () => { f.browser.innerWidth = 1200; f.listeners.get('resize')() })
  assert.equal(f.properties.get('--elysium-list-width'), '444px')
  const detail = () => view.root.findByProps({ 'aria-label': '调整项目详情宽度' })
  await act(async () => detail().props.onPointerDown(pointer))
  await act(async () => detail().props.onPointerMove({ ...pointer, clientX: 1200 - 360 }))
  await act(async () => detail().props.onPointerUp(pointer))
  assert.equal(f.properties.get('--elysium-detail-width'), '360px')
  await act(async () => f.listeners.get('elysium:open-project')({ detail: { id: '12345678' } }))
  assert.equal(f.properties.get('--elysium-list-width'), '444px')
  assert.ok(view.root.findByProps({ 'aria-label': '打开片段分镜 1' }))
  await act(async () => view.unmount())
})

test('project list collapses to the native rail width and only keeps titles', async () => {
  const f = fixture({ width: 1400 }); let view
  const render = () => React.createElement(f.require('elysium/workbench').Workbench)
  await act(async () => { view = create(render()) })
  assert.equal(f.properties.get('--elysium-list-width'), '250px')
  assert.ok(view.root.findByProps({ 'aria-label': '搜索项目' }))
  await act(async () => view.root.findByProps({ 'aria-label': '收起项目列表' }).props.onClick())
  assert.equal(f.properties.get('--elysium-list-width'), '56px')
  assert.equal(view.root.findByProps({ id: 'elysium-workbench-panel' }).props['data-collapsed'], true)
  assert.equal(view.root.findAllByProps({ 'aria-label': '搜索项目' }).length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '新建项目' }).length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '调整项目列表宽度' }).length, 0)
  assert.equal(view.root.findAllByProps({ role: 'tab' }).length, 0)
  assert.ok(view.root.findByProps({ 'aria-label': '打开项目 项目' }))
  assert.equal(f.storage.saved.listCollapsed, true)
  await act(async () => view.unmount())
  await act(async () => { view = create(render()) })
  assert.equal(f.properties.get('--elysium-list-width'), '56px')
  await act(async () => view.root.findByProps({ 'aria-label': '展开项目列表' }).props.onClick())
  assert.equal(f.properties.get('--elysium-list-width'), '250px')
  assert.ok(view.root.findByProps({ 'aria-label': '搜索项目' }))
  await act(async () => view.root.findAllByType('button').find(tab => tab.children.join('') === '素材').props.onClick())
  assert.ok(view.root.findByProps({ 'aria-label': '收起项目列表' }))
  await act(async () => view.unmount())
})

test('project detail sits on the right and collapses to the native rail width', async () => {
  const f = fixture({ width: 1400 }); let view
  const render = () => React.createElement(f.require('elysium/workbench').Workbench)
  await act(async () => { view = create(render()) })
  assert.equal(f.properties.get('--elysium-detail-width'), '400px')
  assert.ok(view.root.findByProps({ 'aria-label': '收起项目详情' }))
  await act(async () => view.root.findByProps({ 'aria-label': '收起项目详情' }).props.onClick())
  assert.equal(f.properties.get('--elysium-detail-width'), '56px')
  assert.equal(view.root.findByProps({ 'aria-label': '当前项目详情' }).props['data-collapsed'], true)
  assert.equal(view.root.findAllByProps({ 'aria-label': '调整项目详情宽度' }).length, 0)
  assert.equal(f.storage.saved.detailCollapsed, true)
  await act(async () => view.unmount())
  await act(async () => { view = create(render()) })
  assert.equal(f.properties.get('--elysium-detail-width'), '56px')
  await act(async () => view.root.findByProps({ 'aria-label': '展开项目详情' }).props.onClick())
  assert.equal(f.properties.get('--elysium-detail-width'), '400px')
  await act(async () => view.unmount())
})

test('legacy servers tab restores as settings', async () => {
  const { require } = fixture({ saved: { activeTab: 'servers' }, media: { token: 't', base: '/media', projectBase: '/project', settingsBase: '/settings' } })
  let view
  await act(async () => { view = create(React.createElement(require('elysium/workbench').Workbench)) })
  assert.ok(view.root.findByProps({ 'aria-label': '模型设置' }))
  assert.equal(view.root.findAllByProps({ role: 'tab' }).find(tab => tab.children.join('') === '设置').props['aria-selected'], true)
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
  await act(async () => view.root.findAllByType('button').find(button => button.children.join('') === '热门漫剧').props.onClick())
  assert.equal(pending[0].signal.aborted, true)
  await act(async () => pending[1].resolve({ items: [{ job_id: 'b'.repeat(32), has_image: true, title: '新结果' }], total: 1 }))
  await act(async () => pending[0].resolve({ items: [{ job_id: 'a'.repeat(32), has_video: true, title: '过期结果' }], total: 1 }))
  assert.match(JSON.stringify(view.toJSON()), /新结果/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /过期结果/)
  assert.equal(view.root.findAllByType('video').length, 0)
  await act(async () => view.unmount())
  assert.equal(pending[1].signal.aborted, true)
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
  assert.equal(changes.at(-1).page, 0); assert.equal(changes.at(-1).q, '')
  assert.match(JSON.stringify(view.toJSON()), /参考.png/)
  assert.equal(view.root.findAllByType('video').length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '查看素材 视频.mp4' }).props.onClick())
  assert.equal(view.root.findAllByType('video').length, 1)
  assert.equal(view.root.findAllByType('button').filter(button => button.children.join('') === '用作项目锚点').length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '关闭对话框' }).props.onClick())
  fail = true
  await act(async () => view.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: '失败.png' }], value: '' } }))
  assert.match(JSON.stringify(view.toJSON()), /导入失败/)
  assert.match(JSON.stringify(view.toJSON()), /参考.png/)
  await act(async () => view.unmount())
})
