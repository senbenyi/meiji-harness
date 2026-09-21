import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

function fixture({ saved = {}, media = { token: 't', base: '/media', projectBase: '/project' }, requests = [], status = { has_video: true } } = {}) {
  let stored = saved
  const series = { logline: '一封信', world: '旧城', characters: [{ name: '林', lead: true, intro: '主角', appearance: '灰外套', voice: '低沉' }], scenes: [], episodes: [{ number: 1, title: '来信', summary: '收到信', hook: '敲门' }] }
  const project = { id: '12345678', title: '项目', genre: '情感', synopsis: '来信', director: 'director-one', updated_at: 1, project_text: '', series_text: '有总览', series, anchors: {},
    episodes: [{ number: 1, script: '## 场 1｜客厅｜林\n动作：林拆信。\n', scenes: [{ number: 1, name: '客厅', roles: ['林'], start: 0, lines: [{ text: '动作：林拆信。', index: 1, shot_id: null }] }], shots: [], film: null }],
    auto: { task: null, paused: null, attempts: {} } }
  const modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { innerWidth: 2000, __ELYSIUM_MEDIA__: media, __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, addEventListener() {}, removeEventListener() {} }, URLSearchParams, URL, AbortController, setTimeout, clearTimeout,
    document: { body: { style: {}, setAttribute() {}, removeAttribute() {} }, documentElement: { style: { setProperty() {}, removeProperty() {} } }, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }, localStorage: { getItem: () => JSON.stringify(stored), setItem: (_, value) => { stored = JSON.parse(value) } },
    fetch: async url => { requests.push(url); return { ok: true, json: async () => url.startsWith('/project/list') ? [{ id: project.id, title: project.title, genre: project.genre, lead: '林', status: 'todo', film_count: 0, episode_count: 1, completed_count: 0, shot_count: 0 }] : url.startsWith('/project/get') || url.startsWith('/project/episode') ? project
      : url.startsWith('/project/plan-read') ? { series: { versions: [], finalized: null }, episodes: {} } : url.startsWith('/media/status') ? status
      : url.startsWith('/settings/models') ? { revision: 0, models: { image: [], video: [] }, selected: { image: '', video: '' } } : { items: [], total: 0 } } } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, stored: () => stored }
}
test('material browser and image picker share source tabs and reset pagination on switch', async () => {
  for (const imageOnly of [false, true]) {
    const requests = [], changes = [], f = fixture({ requests }); let view
    await act(async () => { view = create(React.createElement(f.require('elysium/materials').MaterialList, { imageOnly, viewState: { page: 2 }, onViewState: value => changes.push(value) })) })
    assert.deepEqual(view.root.findAllByProps({ role: 'tab' }).map(tab => tab.children.join('')), ['创作素材', '项目素材', '导入素材'])
    assert.equal(new URL(requests.at(-1), 'https://test').searchParams.get('source'), 'creation')
    for (const [source, label] of [['project', '项目素材'], ['import', '导入素材']]) {
      await act(async () => view.root.findAllByProps({ role: 'tab' }).find(tab => tab.children.join('') === label).props.onClick())
      const query = new URL(requests.at(-1), 'https://test').searchParams
      assert.equal(query.get('source'), source); assert.equal(query.get('offset'), '0')
      if (imageOnly) assert.equal(query.get('media_kind'), 'image')
      assert.equal(changes.at(-1).source, source); assert.equal(changes.at(-1).page, 0)
    }
    await act(async () => view.unmount())
  }
})

test('project workbench has three pages and opens the shared episode view', async () => {
  const f = fixture(); let view
  await act(async () => { view = create(React.createElement(f.require('elysium/workbench').Workbench)) })
  await act(async () => view.root.findByProps({ 'aria-label': '打开创作工作台' }).props.onClick())
  await act(async () => view.root.findAllByProps({ className: 'elysium-project-card' })[0].findAllByType('button')[0].props.onClick())
  assert.deepEqual(view.root.findByProps({ 'aria-label': '项目页签' }).findAllByType('button').map(item => item.children.join('')), ['项目', '总览', '分集'])
  assert.ok(view.root.findAllByProps({ className: 'elysium-episode-main' }).length)
  await act(async () => view.root.findByProps({ 'aria-label': '项目页签' }).findAllByType('button')[1].props.onClick())
  assert.ok(view.root.findAllByProps({ className: 'elysium-series' }).length)
  await act(async () => view.unmount())
})

test('project panel width survives page navigation and reload', async () => {
  const f = fixture({ saved: { width: 900, selected: '12345678', projects: { 12345678: { tab: 'episode', episode: 1 } } } })
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/workbench').Workbench)) })
  await act(async () => view.root.findByProps({ 'aria-label': '打开创作工作台' }).props.onClick())
  assert.equal(view.root.findByProps({ id: 'elysium-workbench-panel' }).props.style.width, '900px')
  for (const label of ['项目', '总览', '分集']) {
    await act(async () => view.root.findByProps({ 'aria-label': '项目页签' }).findAllByType('button').find(item => item.children.join('') === label).props.onClick())
    assert.equal(view.root.findByProps({ id: 'elysium-workbench-panel' }).props.style.width, '900px')
  }
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

test('legacy servers tab restores as settings', async () => {
  const { require } = fixture({ saved: { activeTab: 'servers' }, media: { token: 't', base: '/media', projectBase: '/project', settingsBase: '/settings' } })
  let view
  await act(async () => { view = create(React.createElement(require('elysium/workbench').Workbench)) })
  await act(async () => view.root.findByProps({ 'aria-label': '打开创作工作台' }).props.onClick())
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
  await act(async () => { view = create(React.createElement(require('elysium/materials').MaterialList, { viewState: { page: 2, quality: 'fast', media_kind: 'image', q: '旧搜索' }, onViewState: value => changes.push(value) })) })
  assert.match(view.root.findByProps({ type: 'file' }).props.accept, /\.mp4/)
  const files = [{ name: '参考.png' }, { name: '视频.mp4' }]
  const event = { target: { files, value: 'selected' } }
  await act(async () => view.root.findByProps({ type: 'file' }).props.onChange(event))
  assert.equal(event.target.value, '')
  const uploads = requests.filter(item => item.url.startsWith('/media/upload'))
  assert.equal(uploads.length, 2)
  uploads.forEach((item, index) => { assert.equal(item.options.method, 'POST'); assert.equal(item.options.body, files[index]) })
  assert.equal(changes.at(-1).page, 0); assert.equal(changes.at(-1).quality, ''); assert.equal(changes.at(-1).media_kind, '')
  assert.equal(changes.at(-1).source, 'import')
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
