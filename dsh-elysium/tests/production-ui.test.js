// 职责：验证七步卡片、单段/批量提交范围及实际输入编辑。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { clientSource } from '../scripts/loader.js'
import { initialProduction, segmentValues, sceneValues } from '../src/database/schemas/production.js'
test('overview submits all segments while input details submit only the current segment', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  runInNewContext(clientSource(), { window: { confirm: () => true, __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, structuredClone, URL, URLSearchParams })
  const project = { id: '1234abcd', title: '书店', updated_at: 1, production: initialProduction({ brief: '书店重逢' }) }
  const p = project.production
  p.story.scenes = sceneValues([{ id: 'scene-a', description: '重逢', duration: 10 }])
  p.segments = segmentValues([1, 2].map(n => ({ id: `segment-${n}`, scene_id: 'scene-a', title: `片段${n}`, duration: 5, description: '微笑' })), p)
  for (const s of p.segments) { s.shots_revision = 0; s.shots = [{ id: 'shot-1', duration: 5, start: 0, action: '微笑' }]; s.inputs = [{ id: 'input-1', source_revision: 0, plan: { prompt: '五秒微笑', mode: 't2va' } }] }
  cache.set('elysium/project-api', { workflowAction: async (id, action, body) => { calls.push({ id, action, body }); return project } })
  cache.set('elysium/materials', { MaterialList: () => null })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let downloadError = false
  const downloads = []
  require('elysium/media-api').saveExport = async (project, output) => { downloads.push([project.id, output.id]); if (downloadError) throw new Error('连接中断'); return '已保存：书店-第1集.mp4' }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project, busy: false, run: async fn => { await fn(); return true } })) })
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-section elysium-production-step' }).length, 7)
  const find = text => view.root.findAllByType('button').find(b => b.children.join('') === text)
  assert.equal(find('下一步：自动合片').props.disabled, true)
  await act(async () => view.root.findByProps({ 'aria-label': '打开片段分镜 1' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '打开分镜 1' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '运镜' }).props.onChange({ target: { value: '缓慢推进' } }))
  await act(async () => find('保存并审核分镜').props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '片段名称' }).props.value, '片段1')
  await act(async () => find('‹ 返回项目总览').props.onClick())
  assert.equal(find('自动合片').props.disabled, true)
  calls.length = 0
  await act(async () => find('提交全部待生成片段').props.onClick())
  assert.equal(calls[0].action, 'production-submit'); assert.equal(calls[0].body.segment_id, undefined)
  await act(async () => view.root.findByProps({ 'aria-label': '打开H3 输入 2' }).props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '最终 H3 Prompt' }).props.value, '五秒微笑')
  await act(async () => find('提交当前 Segment').props.onClick())
  assert.equal(calls[1].body.segment_id, 'segment-2')
  await act(async () => view.root.findByProps({ 'aria-label': '最终 H3 Prompt' }).props.onChange({ target: { value: '新的最终输入' } }))
  assert.equal(find('提交当前 Segment').props.disabled, true)
  await act(async () => find('保存 H3 输入').props.onClick())
  assert.equal(calls[2].body.prompt, '新的最终输入'); assert.equal(calls[2].body.segment_id, 'segment-2')
  await act(async () => find('‹ 返回项目总览').props.onClick())
  p.segments.forEach((s, i) => { s.generations = [{ id: `video-${i}`, input_id: 'input-1', status: 'succeeded', url: `https://video.example/${i}.mp4`, duration: 5 }] })
  await act(async () => view.update(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project: { ...project, updated_at: 2 }, busy: false, run: async fn => { await fn(); return true } })))
  await act(async () => view.root.findByProps({ 'aria-label': '总集数' }).props.onChange({ target: { value: '2' } }))
  assert.equal(find('自动合片').props.disabled, false)
  await act(async () => find('自动合片').props.onClick())
  assert.equal(calls.at(-1).action, 'production-compose'); assert.equal(calls.at(-1).body.episode_count, 2)
  p.exports = [{ id: 'export-1', title: '第 1 集', status: 'succeeded', episode_count: 2, created_at: 1, url: 'https://video.example/episode1.mp4', duration: 5, timeline: { clips: [{}] } }]
  await act(async () => view.update(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project: { ...project, updated_at: 3 }, busy: false, run: async () => true })))
  await act(async () => view.root.findByProps({ 'aria-label': '打开成片 1' }).props.onClick())
  assert.equal(view.root.findByType('video').props.src, 'https://video.example/episode1.mp4')
  await act(async () => find('下载成片').props.onClick())
  assert.deepEqual(downloads, [['1234abcd', 'export-1']])
  assert.ok(view.root.findAllByProps({ role: 'status' }).some(n => n.children.join('').includes('已保存：书店-第1集.mp4')))
  downloadError = true
  await act(async () => find('下载成片').props.onClick())
  assert.equal(view.root.findByProps({ role: 'alert' }).children.join(''), '下载失败：连接中断')
  assert.equal(find('下载成片').props.disabled, false)

  await act(async () => find('‹ 返回项目总览').props.onClick())
  p.segments.forEach(s => { s.inputs = [] })
  await act(async () => view.update(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project: { ...project, updated_at: 2 }, busy: false, run: async () => true })))
  assert.equal(find('下一步：自动合片').props.disabled, true)
  await act(async () => view.unmount())
})

test('story model follows the associated session model directory', async () => {
  const modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, URL, URLSearchParams })
  cache.set('elysium/project-api', {})
  cache.set('elysium/production-workflow', {})
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const generation = require('elysium/project-generation')
  let listener, current = { provider: 'local', model: 'qwen3.8' }, requested
  generation.apply({ sessions: { scope: () => ({}), list: { subscribe: () => () => {} } }, slots: { inject: () => {} }, uiConversation: { events: { register: () => {} } }, modelDirectories: { directoryFor: id => { requested = id; return { store: { getSnapshot: () => ({ current }), subscribe: fn => { listener = fn; return () => { listener = null } } }, load: async () => {} } } } })
  let view
  await act(async () => { view = create(React.createElement(generation.StoryModel, { sessionId: 'project-session' })) })
  assert.equal(requested, 'project-session')
  assert.match(view.root.findByType('p').children.join(''), /local \/ qwen3.8/)
  await act(async () => { current = { provider: 'other', model: 'new-model' }; listener() })
  assert.match(view.root.findByType('p').children.join(''), /other \/ new-model/)
  await act(async () => view.unmount())
  assert.equal(listener, null)
})

test('later segments show the AI continuity decision and reason without a manual toggle', async () => {
  const modules = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } } })
  const { SegmentEditor } = modules.get('elysium/segment-editor')(() => React)
  const production = initialProduction({ brief: '连续场景' })
  production.story.scenes = sceneValues([{ id: 'scene-a', description: '相遇', duration: 10 }])
  const values = segmentValues([1, 2].map(n => ({ id: `segment-${n}`, scene_id: 'scene-a', duration: 5, description: '走近', use_previous_tail: n > 1, tail_reason: n === 1 ? '首段' : '同一时空继续走近，位置与构图连续' })), production)
  let edited, view
  const props = { assets: [], scenes: production.story.scenes, change: v => { edited = v } }
  await act(async () => { view = create(React.createElement(SegmentEditor, { ...props, value: values[0] })) })
  assert.equal(view.root.findAllByProps({ 'aria-label': '片段衔接规划' }).length, 0)
  await act(async () => view.update(React.createElement(SegmentEditor, { ...props, value: values[1], previous: values[0] })))
  assert.equal(view.root.findAllByProps({ type: 'checkbox' }).length, 0)
  assert.match(JSON.stringify(view.toJSON()), /沿用上一段尾帧作为首帧/)
  assert.match(JSON.stringify(view.toJSON()), /同一时空继续走近，位置与构图连续/)
  await act(async () => view.root.findByProps({ 'aria-label': '片段名称' }).props.onChange({ target: { value: '继续走近' } }))
  assert.equal(edited.use_previous_tail, true); assert.equal(edited.tail_reason, values[1].tail_reason)
  await act(async () => view.update(React.createElement(SegmentEditor, { ...props, value: { ...values[1], use_previous_tail: false, tail_reason: '次日转到室外' }, previous: values[0] })))
  assert.match(JSON.stringify(view.toJSON()), /独立起镜，不沿用上一段尾帧/)
  assert.match(JSON.stringify(view.toJSON()), /次日转到室外/)
  await act(async () => view.update(React.createElement(SegmentEditor, { ...props, value: { ...values[1], tail_reason: '' }, previous: values[0] })))
  assert.match(JSON.stringify(view.toJSON()), /尚无 AI 衔接判断/)
  await act(async () => view.unmount())
})

test('export saving selects a path before fetching and handles cancellation, stream failure and fallback', async () => {
  const modules = new Map(), events = [], bytes = []
  const project = { id: '1234abcd', title: '书店/重逢' }, output = { id: 'output-id', title: '第1集' }
  const window = { __ELYSIUM_MEDIA__: { token: 'test', base: '/media' }, __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }
  let options, failRead = false, aborted = false, closed = false
  const writable = () => new WritableStream({ write: chunk => bytes.push(...chunk), close: () => { closed = true }, abort: () => { aborted = true } })
  window.showSaveFilePicker = async value => { options = value; events.push('picker'); return { name: '自定义.mp4', createWritable: async () => { events.push('writable'); return writable() } } }
  let responseStatus = 200
  const fetch = async (_, options) => {
    events.push(options.method)
    return { ok: responseStatus === 200, status: responseStatus, json: async () => ({ error: '下载不可用' }), body: new ReadableStream({ start(controller) { if (failRead) controller.error(new Error('连接中断')); else { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() } } }) }
  }
  const anchor = { click: () => events.push('click'), remove: () => events.push('remove') }
  const document = { createElement: () => anchor, body: { appendChild: () => events.push('append') } }
  runInNewContext(clientSource(), { window, document, fetch, URLSearchParams, AbortController })
  const api = modules.get('elysium/media-api')()
  assert.equal(await api.saveExport(project, output), '已保存：自定义.mp4')
  assert.equal(options.suggestedName, '书店_重逢-第1集.mp4')
  assert.deepEqual(events, ['picker', 'GET', 'writable']); assert.deepEqual(bytes, [1, 2, 3]); assert.equal(closed, true)
  failRead = true
  await assert.rejects(api.saveExport(project, output), /连接中断/)
  assert.equal(aborted, true)
  failRead = false; responseStatus = 502; events.length = 0
  await assert.rejects(api.saveExport(project, output), /下载不可用/)
  assert.deepEqual(events, ['picker', 'GET'])
  window.showSaveFilePicker = async () => { throw Object.assign(new Error('取消'), { name: 'AbortError' }) }
  events.length = 0
  assert.equal(await api.saveExport(project, output), ''); assert.deepEqual(events, [])
  window.showSaveFilePicker = undefined; responseStatus = 200
  assert.match(await api.saveExport(project, output), /保存位置由浏览器下载设置决定/)
  assert.deepEqual(events, ['HEAD', 'append', 'click', 'remove'])
  assert.equal(anchor.href, '/media/export-download?project=1234abcd&export=output-id&t=test')
})
