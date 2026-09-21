// 职责：验证工作台五步导航、生产面板控制、依赖放行与成片页展示。
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'

const entry = (value, finalized = 1, needs_review = false) => ({ versions: [{ version: 1, value }], finalized, needs_review })
const series = { episode_count: 3, episode_seconds: 10, characters: [{ id: 'lin' }], scenes: [{ id: 'room' }],
  episodes: [1, 2, 3].map(number => ({ number, title: `第 ${number} 集`, summary: '雨夜', hook: '门外有人' })) }
const auto = { enabled: false, until_episode: null, anchors_confirmed: false, cascade_confirmed: false, paused: null, attempts: {} }
const shot = (id, extra = {}) => ({ id, roles: ['lin'], scene: 'room', shot_size: '近景', camera: '固定', action: `动作 ${id}`, duration: 5, dialogue: [{ role: 'lin', text: '你好' }],
  subtitle: '你好', prompt: '提示词', keyframe_prompt: 'frame', prompt_finalized: true, take: 1, keyframe_job_id: 'c'.repeat(32), job_id: 'd'.repeat(32), status: 'succeeded', ...extra })
const project = (extra = {}) => ({ id: '1234abcd', title: '雨夜', director: 'director-a', genre: '悬疑', synopsis: '一封信', updated_at: 1, auto, materials: [], anchors: [
  { role: 'lin', kind: 'character', label: '林', description: '灰外套', image_prompt: 'man', image_job_id: 'a'.repeat(32), source: { type: 'job', job_id: 'a'.repeat(32) } },
  { role: 'scene-room', kind: 'scene', label: '公寓', description: '雨夜', source: null }], episodes: [], ...extra })

function fixture({ value = project(), plan = { series: entry(series), episodes: {} }, confirm = () => true } = {}) {
  let current = structuredClone(value)
  const calls = [], modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { AbortController, setTimeout, clearTimeout, URLSearchParams, URL,
    window: { __ELYSIUM_MEDIA__: { token: 't', base: '/media', projectBase: '/project', directorBase: '/director' },
      __ModuleLoader__: { load: item => modules.set(item.id, item.factory) }, confirm }, document: {},
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, body })
      const reply = value => ({ ok: true, json: async () => structuredClone(value) })
      if (url.startsWith('/director/list')) return reply([])
      if (url.startsWith('/project/plan-read')) return reply(plan)
      if (url.startsWith('/project/plan-edit') && body.step === 'storyboard') {
        const entry = plan.episodes[body.episode].storyboard ||= { versions: [], finalized: null }, version = entry.versions.length + 1
        entry.versions.push({ version, value: body.value })
        if (body.auto_finalize) entry.finalized = version
        return reply(plan)
      }
      if (url.startsWith('/project/episode')) {
        const number = Number(new URL(url, 'http://localhost').searchParams.get('number')), episode = current.episodes.find(item => item.number === number)
        return reply({ ...current, episode: number, acts: episode?.acts || [], deliverables: episode?.deliverables || [], film_task: episode?.film_task || null })
      }
      if (url.startsWith('/project/auto-start')) current.auto = { ...current.auto, enabled: true, until_episode: body.until_episode }
      if (url.startsWith('/project/auto-pause')) current.auto = { ...current.auto, enabled: false }
      if (url.startsWith('/project/auto-resume')) current.auto = { ...current.auto, enabled: true, paused: null }
      if (url.startsWith('/media/status')) return reply({ has_image: true, has_video: true })
      return reply(current)
    } })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  return { require, calls, project: () => current }
}
const text = view => JSON.stringify(view.toJSON())
const button = (view, label) => view.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.join('') === label)
const click = (view, label) => act(async () => button(view, label).props.onClick())

test('single-episode script text preserves timeline data and reports malformed lines', () => {
  const { formatTimeline, parseTimeline } = fixture().require('elysium/planning')
  const overview = { scenes: [{ id: 'a', name: '婚礼｜现场' }], characters: [{ id: 'lin', name: '林、辰' }, { id: 'su', name: '苏婉清' }] }
  const timeline = { beats: [{ start: 0, end: 12.5, scene_id: 'a', roles: ['lin', 'su'], plot: '收起戒指\n走出会场', emotion: '克制：反转', dialogue: [
    { role: 'su', tone: '冷淡', text: '到此为止。' }, { role: 'lin', tone: '平静', text: '你会记住今天。' }] },
  { start: 12.5, end: 25, scene_id: 'a', roles: ['lin'], plot: '拿出黑卡', emotion: '悬念', dialogue: [] }] }
  const source = formatTimeline(timeline, overview)
  assert.match(source, /00:12.5/)
  assert.deepEqual(JSON.parse(JSON.stringify(parseTimeline(source, overview))), timeline)
  assert.throws(() => parseTimeline(source.replace('情绪：', '心情：'), overview), /第 3 行/)
})

test('single-episode storyboard markdown preserves every field and rejects malformed headings', () => {
  const { formatStoryboard, parseStoryboard } = fixture().require('elysium/planning')
  const overview = { scenes: [{ id: 'room', name: '公寓｜夜' }], characters: [{ id: 'lin', name: '林、辰' }] }
  const storyboard = { shots: [{ scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '打开信\n抬头', duration: 10,
    dialogue: [{ role: 'lin', text: '是谁：寄来的？' }] }] }
  const source = formatStoryboard(storyboard, overview)
  assert.match(source, /# 单集分镜\n\n## 镜头 1/)
  assert.deepEqual(JSON.parse(JSON.stringify(parseStoryboard(source, overview))), storyboard)
  assert.throws(() => parseStoryboard(source.replace('景别：', '画面：'), overview), /需要「景别：」/)
})

test('storyboard uses one markdown editor and saves directly without version or finalization controls', async () => {
  const overview = { ...series, characters: [{ id: 'lin', name: '林' }], scenes: [{ id: 'room', name: '公寓' }] }
  const storyboard = { shots: [{ scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '缓推', action: '林打开信', duration: 10, dialogue: [] }] }
  const f = fixture({ plan: { series: entry(overview), episodes: { 1: { timeline: entry({ beats: [] }), storyboard: entry(storyboard) } } } })
  const view = await mount(f, 'storyboard')
  const editor = view.root.findByProps({ 'aria-label': '单集分镜正文' })
  assert.equal(view.root.findAllByType('textarea').length, 1)
  assert.equal(button(view, '定稿'), undefined)
  assert.equal(view.root.findAllByProps({ 'aria-label': '单集分镜版本' }).length, 0)
  await act(async () => editor.props.onChange({ target: { value: editor.props.value.replace('林打开信', '林收起信') } }))
  await click(view, '保存')
  const saved = f.calls.find(call => call.url.startsWith('/project/plan-edit'))?.body
  assert.equal(saved.auto_finalize, true)
  assert.deepEqual(saved.value.shots[0].action, '林收起信')
  assert.equal(f.calls.some(call => call.url.startsWith('/project/plan-finalize')), false)
  assert.match(view.root.findByProps({ 'aria-label': '单集分镜正文' }).props.value, /林收起信/)
  const edited = view.root.findByProps({ 'aria-label': '单集分镜正文' })
  await act(async () => edited.props.onChange({ target: { value: edited.props.value.replace('景别：', '画面：') } }))
  await click(view, '保存')
  assert.match(text(view), /需要「景别：」/)
  assert.equal(f.calls.filter(call => call.url.startsWith('/project/plan-edit')).length, 1)
  await act(async () => view.unmount())
})

test('a new episode storyboard can be written directly in the markdown editor', async () => {
  const overview = { ...series, characters: [{ id: 'lin', name: '林' }], scenes: [{ id: 'room', name: '公寓' }] }
  const f = fixture({ plan: { series: entry(overview), episodes: { 1: { timeline: entry({ beats: [] }) } } } })
  const view = await mount(f, 'storyboard')
  assert.equal(button(view, '保存').props.disabled, true)
  const source = '# 单集分镜\n\n## 镜头 1\n场景：公寓\n人物：林\n景别：近景\n运镜：缓推\n动作：林打开信\n时长：10\n对白：\n无'
  await act(async () => view.root.findByProps({ 'aria-label': '单集分镜正文' }).props.onChange({ target: { value: source } }))
  await click(view, '保存')
  assert.equal(f.calls.find(call => call.url.startsWith('/project/plan-edit')).body.auto_finalize, true)
  assert.match(view.root.findByProps({ 'aria-label': '单集分镜正文' }).props.value, /林打开信/)
  await act(async () => view.unmount())
})

test('script timeline shows a single episode editor beside the episode directory', async () => {
  const overview = { ...series, genre: '悬疑', logline: '雨夜来信', world: '旧城', characters: [{ id: 'lin', name: '林', appearance: '', voice: '', personality: '', image_prompt: '' }],
    scenes: [{ id: 'room', name: '公寓', description: '' }] }
  const timeline = { beats: [{ start: 0, end: 10, scene_id: 'room', roles: ['lin'], plot: '打开信封', emotion: '惊讶', dialogue: [{ role: 'lin', tone: '低声', text: '是谁？' }] }] }
  const f = fixture({ plan: { series: entry(overview), episodes: { 1: { timeline: entry(timeline, 1, true) } } } }), view = await mount(f, 'script')
  await click(view, '分集时间线')
  assert.equal(view.root.findByProps({ 'aria-label': '选择剧集' }).findAllByType('button').length, 3)
  assert.match(text(view), /打开信封/)
  assert.equal(view.root.findAllByType('textarea').length, 1)
  assert.equal(button(view, '编辑'), undefined)
  assert.equal(button(view, '定稿'), undefined)
  assert.doesNotMatch(text(view), /剧情总览已变化|需更新/)
  assert.match(view.root.findByProps({ 'aria-label': '本集剧本' }).props.value, /00:00-00:10｜公寓｜林/)
  await act(async () => view.unmount())
})

test('unsaved episode text blocks switching and malformed text never reaches plan-edit', async () => {
  const overview = { ...series, genre: '悬疑', logline: '雨夜来信', world: '旧城', characters: [{ id: 'lin', name: '林' }], scenes: [{ id: 'room', name: '公寓' }] }
  const timeline = { beats: [{ start: 0, end: 10, scene_id: 'room', roles: ['lin'], plot: '打开信封', emotion: '惊讶', dialogue: [] }] }
  const f = fixture({ plan: { series: entry(overview), episodes: { 1: { timeline: entry(timeline) } } }, confirm: () => false })
  const guard = { current: null }; let view
  await act(async () => { view = create(React.createElement(f.require('elysium/planning').ScriptView, { projectId: '1234abcd', viewState: { scriptTab: 'timeline' }, guard })) })
  await act(async () => view.root.findByProps({ 'aria-label': '本集剧本' }).props.onChange({ target: { value: '错误正文' } }))
  assert.ok(guard.current)
  await act(async () => view.root.findByProps({ 'aria-label': '选择剧集' }).findAllByType('button')[1].props.onClick())
  assert.match(text(view), /第 1 集 · 第 1 集/)
  await click(view, '保存')
  assert.match(text(view), /第 1 行/)
  assert.equal(f.calls.some(call => call.url.startsWith('/project/plan-edit')), false)
  await act(async () => view.unmount())
})
async function mount(f, tab) {
  let view
  await act(async () => { view = create(React.createElement(f.require('elysium/projects').ProjectDetail, { id: '1234abcd', viewState: tab ? { projectTab: tab } : {}, back() {} })) })
  return view
}

test('project navigation has five steps, opens at the first unfinished stage and lets anchors follow the series', async () => {
  const f = fixture(), view = await mount(f)
  assert.deepEqual(view.root.findByProps({ 'aria-label': '制作流程' }).findAllByType('button').map(node => node.props['aria-label']), ['项目', '剧本', '锚点', '分镜', '成片'])
  assert.equal(view.root.findByProps({ 'aria-label': '锚点' }).props['aria-current'], 'step')
  assert.equal(view.root.findAllByProps({ className: 'elysium-production' }).length, 0)
  await click(view, '剧本')
  assert.equal(button(view, '继续到锚点').props.disabled, false)
  assert.doesNotMatch(text(view), /一键生产/)
  assert.doesNotMatch(text(view), /生成全部集时间线/)
  await click(view, '锚点')
  assert.equal(view.root.findAllByProps({ className: 'elysium-production' }).length, 0)
  assert.equal(button(view, '继续到分镜').props.disabled, false)
  await click(view, '分镜')
  assert.equal(view.root.findAllByProps({ className: 'elysium-production' }).length, 0)
  assert.equal(button(view, '继续到成片').props.disabled, true)
  await click(view, '成片')
  assert.equal(view.root.findAllByProps({ className: 'elysium-production' }).length, 0)
  await act(async () => view.unmount())
})

test('production panel starts a range, pauses, jumps to the paused shot and resumes', async () => {
  const paused = { reason: '第 2 集镜头 s9 生成失败：显存不足', episode: 2, step: 'shot', shot_id: 's9' }
  const f = fixture(), view = await mount(f, 'project')
  assert.match(text(view), /未开启/)
  await act(async () => view.root.findByProps({ 'aria-label': '生产范围' }).props.onChange({ target: { value: '2' } }))
  await click(view, '一键生产')
  assert.deepEqual(f.calls.find(call => call.url.startsWith('/project/auto-start')).body, { id: '1234abcd', until_episode: 2 })
  assert.match(text(view), /生产中 · 第 1 集时间线/)
  await click(view, '暂停')
  assert.deepEqual(f.calls.find(call => call.url.startsWith('/project/auto-pause')).body, { id: '1234abcd' })
  f.project().auto = { ...f.project().auto, enabled: true, paused }
  const again = await mount(f, 'project')
  assert.match(text(again), /显存不足/)
  await click(again, '去处理')
  assert.equal(again.root.findByProps({ 'aria-label': '分镜' }).props['aria-current'], 'step')
  assert.equal(again.root.findAllByProps({ className: 'elysium-production' }).length, 0)
  await click(again, '项目')
  await click(again, '继续')
  assert.ok(f.calls.some(call => call.url.startsWith('/project/auto-resume')))
  assert.doesNotMatch(text(again), /显存不足/)
  await act(async () => { view.unmount(); again.unmount() })
})

test('completed, active and untouched project stages and episodes use distinct states', async () => {
  const value = project({ auto: { ...auto, anchors_confirmed: true }, episodes: [
    { number: 1, acts: [{ shots: [shot('s1')] }], deliverables: [{ type: 'film', job_id: 'e'.repeat(32) }], film_task: { status: 'succeeded' } },
    { number: 2, acts: [{ shots: [shot('s2')] }], deliverables: [], film_task: null },
  ] })
  const f = fixture({ value }), view = await mount(f, 'film')
  for (const label of ['项目', '剧本', '锚点']) assert.equal(view.root.findByProps({ 'aria-label': label }).props['data-complete'], true)
  assert.equal(view.root.findByProps({ 'aria-label': '分镜' }).props['data-progress'], true)
  assert.equal(view.root.findByProps({ 'aria-label': '成片' }).props['data-progress'], true)
  const episodes = view.root.findByProps({ 'aria-label': '选择剧集' }).findAllByType('button')
  assert.equal(episodes[0].props['data-complete'], true)
  assert.equal(episodes[1].props['data-progress'], true)
  assert.equal(episodes[2].props['data-complete'], undefined)
  assert.equal(episodes[2].props['data-progress'], undefined)
  await act(async () => view.unmount())
})

test('film tab shows the pipeline status and lists the latest film and subtitle downloads', async () => {
  const films = [{ type: 'film', label: '第 1 集 · 雨夜', job_id: 'e'.repeat(32), created_at: 1, duration_sec: 10 },
    { type: 'film', label: '第 1 集 · 雨夜', job_id: 'f'.repeat(32), created_at: 2, duration_sec: 10 },
    { type: 'subtitle', label: '第 1 集 · 雨夜', job_id: '9'.repeat(32), created_at: 2 }]
  const value = project({ episodes: [{ number: 1, acts: [{ title: '第 1 集', shots: [shot('s1')] }], deliverables: films, film_task: { status: 'succeeded' } }] })
  const f = fixture({ value }), view = await mount(f, 'film')
  assert.match(text(view), /本集成片已完成/)
  assert.equal(view.root.findByProps({ 'aria-label': '选择成片版本' }).props.value, 'f'.repeat(32))
  const links = view.root.findAllByType('a').map(node => [node.props['aria-label'], new URL(node.props.href, 'http://localhost').searchParams.get('job')])
  assert.deepEqual(links, [['下载成片 第 1 集 · 雨夜', 'f'.repeat(32)], ['下载字幕 第 1 集 · 雨夜', '9'.repeat(32)], ['下载成片 第 1 集 · 雨夜', 'e'.repeat(32)]])
  assert.equal(button(view, '合成本集'), undefined)
  await act(async () => view.unmount())
  const failed = fixture({ value: project({ episodes: [{ number: 1, acts: [], deliverables: [], film_task: { status: 'failed', error: '音轨缺失' } }] }) })
  const failedView = await mount(failed, 'film')
  assert.match(text(failedView), /合成失败：音轨缺失/)
  await act(async () => failedView.unmount())
})
