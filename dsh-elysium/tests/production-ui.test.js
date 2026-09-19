// 职责：验证六步卡片、单段/批量提交范围及实际输入编辑。
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
  cache.set('elysium/project-api', { fetchProject: async () => project, workflowAction: async (id, action, body) => { calls.push({ id, action, body }); return project } })
  cache.set('elysium/materials', { MaterialList: () => null })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let downloadError = false
  const downloads = []
  require('elysium/media-api').saveExport = async (project, output) => { downloads.push([project.id, output.id]); if (downloadError) throw new Error('连接中断'); return '已保存：书店-第1集.mp4' }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project, busy: false, run: async fn => { await fn(); return true } })) })
  assert.equal(view.root.findAllByProps({ className: 'elysium-episode-section elysium-production-step' }).length, 6)
  const find = text => view.root.findAllByType('button').find(b => b.children.join('') === text)
  const execute = title => view.root.findByProps({ 'aria-label': `执行${title}` })
  assert.equal(execute('完整成片').props.disabled, false)
  assert.equal(view.root.findAllByType('button').filter(b => String(b.children.join('')).startsWith('下一步')).length, 0)
  assert.ok(view.root.findAllByProps({ className: 'elysium-story-model' }).some(n => n.children.join('').startsWith('大模型：')))
  await act(async () => view.root.findByProps({ 'aria-label': '打开片段分镜 1' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '打开分镜 1' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '运镜' }).props.onChange({ target: { value: '缓慢推进' } }))
  await act(async () => find('保存并审核分镜').props.onClick())
  assert.equal(view.root.findByProps({ 'aria-label': '片段名称' }).props.value, '片段1')
  await act(async () => find('‹ 返回项目总览').props.onClick())
  assert.equal(execute('完整成片').props.disabled, false)
  calls.length = 0
  await act(async () => execute('Segment 视频').props.onClick())
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
  assert.ok(view.root.findAllByType('p').some(n => n.children.join('') === '共 1 集'))
  assert.equal(view.root.findAllByProps({ 'aria-label': '总集数' }).length, 0)
  assert.equal(view.root.findAllByType('button').filter(b => b.children.join('') === '编辑合片').length, 0)
  await act(async () => view.root.findByProps({ 'aria-label': '完整成片' }).props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '总集数' }).props.onChange({ target: { value: '2' } }))
  await act(async () => find('执行').props.onClick())
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
  assert.equal(execute('完整成片').props.disabled, false)
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
  assert.match(view.root.findByType('p').children.join(''), /大模型：local \/ qwen3.8/)
  await act(async () => { current = { provider: 'other', model: 'new-model' }; listener() })
  assert.match(view.root.findByType('p').children.join(''), /other \/ new-model/)
  await act(async () => view.unmount())
  assert.equal(listener, null)
})

test('batch progress resumes the existing request and a send failure preserves saved work', async () => {
  const modules = new Map(), cache = new Map(), messages = [], actions = []
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, structuredClone, URL, URLSearchParams })
  const project = { id: '1234abcd', title: '批次测试', chat_session_id: 'session', production: initialProduction({ brief: '书店阅读' }) }
  project.production.request = { id: 'existing-request', stage: 'segments', session_id: 'session', batch: { index: 2, items: Array(8).fill({}) } }
  let failSend = false, currentSession = 'session'
  cache.set('elysium/project-api', { fetchProject: async () => project, workflowAction: async (_, action) => { actions.push(action); return project } })
  cache.set('elysium/materials', { MaterialList: () => null })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const generation = require('elysium/project-generation')
  generation.apply({ sessions: { list: { getSnapshot: () => ({ current: currentSession }) }, scope: () => ({ get: () => ({ send: async message => { if (failSend) throw new Error('连接中断'); messages.push(message) } }) }) }, slots: { inject: () => {} }, uiConversation: { events: { register: () => {} } } })
  let view
  await act(async () => { view = create(React.createElement(generation.ProjectWorkflow, { project, busy: false, run: async fn => { await fn(); return true } })) })
  assert.equal(view.root.findByProps({ className: 'elysium-current-flow' }).children.join(''), '当前流程：片段规划  状态同步中')
  assert.match(JSON.stringify(view.toJSON()), /已保存 2 批 \/ 8 项/)
  assert.equal(view.root.findAllByProps({ className: 'elysium-generating-notice' }).length, 0)
  await act(async () => generation.resumeProduction(project))
  assert.match(messages[0], /request_id=existing-request/)
  assert.match(messages[0], /直到回执 request=null/)
  assert.deepEqual(actions, ['production-resume-request'], 'resume only activates the existing request')
  failSend = true
  await assert.rejects(generation.resumeProduction(project), /连接中断/)
  await assert.rejects(generation.generateProduction(project, 'segments'), /连接中断/)
  assert.deepEqual(actions, ['production-resume-request', 'production-resume-request', 'production-request-error', 'production-request', 'production-request-error'])
  assert.equal(project.production.request.batch.items.length, 8)
  currentSession = 'another-session'
  await assert.rejects(generation.resumeProduction(project), /关联对话/)
  await act(async () => view.unmount())
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

test('story within 30 seconds of the target can proceed to segment planning', async () => {
  const modules = new Map(), cache = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, structuredClone, URL, URLSearchParams })
  const project = { id: '1234abcd', title: '书店', updated_at: 1, production: initialProduction({ brief: '书店重逢' }) }
  const p = project.production
  p.target_seconds = 180
  p.story.text = '书店重逢。'
  p.story.scenes = sceneValues([{ id: 'scene-a', description: '重逢', duration: 185 }])
  cache.set('elysium/project-api', { workflowAction: async () => project })
  cache.set('elysium/materials', { MaterialList: () => null })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project, busy: false, run: async () => true })) })
  const execute = title => view.root.findByProps({ 'aria-label': `执行${title}` })
  assert.equal(execute('生成剧情与 Segment').props.disabled, false)
  assert.equal(view.root.findAllByProps({ 'aria-label': '打开Segment 1' }).length, 0)
  assert.equal(view.root.findAllByProps({ 'aria-label': '打开片段分镜 1' }).length, 0)
  assert.ok(view.root.findAllByType('strong').some(n => n.children.join('') === '还未生成'))
  assert.ok(!view.root.findAllByProps({ role: 'alert' }).some(n => n.children.join('').includes('总时长不一致')))
  p.story.scenes = sceneValues([{ id: 'scene-a', description: '过长', duration: 220 }])
  await act(async () => view.update(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project: { ...project, updated_at: 2 }, busy: false, run: async () => true })))
  assert.equal(execute('生成剧情与 Segment').props.disabled, false)
  assert.ok(view.root.findAllByProps({ role: 'alert' }).some(n => n.children.join('').includes('总时长不一致')))
  await act(async () => view.unmount())
})

test('every card exposes its own status and retry remains available during an active stage', async () => {
  const modules = new Map(), cache = new Map(), events = []
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, structuredClone, URL, URLSearchParams })
  let project = { id: '1234abcd', title: '重试测试', chat_session_id: 'session', production: initialProduction({ brief: '阅读' }) }
  project.production.request = { id: 'old', stage: 'segments', session_id: 'session', batch: { index: 2, items: Array(8).fill({}) } }
  cache.set('elysium/project-api', {
    fetchProject: async () => { events.push('read'); return project },
    workflowAction: async (_, action, body) => { events.push([action, body]); project = { ...project, production: { ...project.production, request: { id: 'new', stage: body.stage, session_id: 'session' } } }; return project },
  })
  cache.set('elysium/materials', { MaterialList: () => null })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const generation = require('elysium/project-generation'), listeners = new Set()
  let snapshot = { running: true, openState: 'open', lastAgentError: null }
  const face = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  const scope = { get: () => ({ cancel: async () => events.push('stop'), send: async text => events.push(text) }) }
  generation.apply({ sessions: { list: { getSnapshot: () => ({ current: 'session' }) }, scope: () => scope, sessionOf: () => face }, slots: { inject: () => {} }, uiConversation: { events: { register: () => {} } } })
  let view
  await act(async () => { view = create(React.createElement(generation.ProjectWorkflow, { project, busy: false, run: async fn => { await fn(); return true } })) })
  const cards = () => view.root.findAllByProps({ className: 'elysium-episode-section elysium-production-step' })
  assert.equal(cards().length, 6)
  assert.ok(cards().every(c => c.findAllByProps({ className: 'elysium-step-status' }).length))
  assert.equal(cards()[1].findByProps({ className: 'elysium-step-status' }).children[0], '生成中')
  assert.equal(cards()[0].findAllByType('button').find(b => b.children.join('') === '编辑').props.disabled, false)
  for (const title of ['生成剧情与 Segment', '分镜与素材审核', 'H3 输入结果', 'Segment 视频', '完整成片']) assert.equal(view.root.findByProps({ 'aria-label': `执行${title}` }).props.disabled, false)
  await act(async () => { snapshot = { ...snapshot, running: false }; listeners.forEach(fn => fn()) })
  assert.equal(cards()[1].findByProps({ className: 'elysium-step-status' }).children[0], '已中断')
  assert.equal(view.root.findByProps({ className: 'elysium-current-flow' }).children.join(''), '当前流程：片段规划  已中断')
  await act(async () => { snapshot = { ...snapshot, lastAgentError: '输出中断' }; listeners.forEach(fn => fn()) })
  assert.equal(cards()[1].findByProps({ className: 'elysium-step-status' }).children[0], '生成失败')
  snapshot = { ...snapshot, running: true }
  await act(async () => cards()[1].findByProps({ 'aria-label': '执行生成剧情与 Segment' }).props.onClick())
  assert.equal(events[0], 'read')
  assert.equal(events[1][0], 'production-request'); assert.equal(events[1][1].restart, true); assert.equal(events[1][1].stage, 'story'); assert.equal(events[1][1].plan_segments, true)
  assert.equal(events[2], 'stop'); assert.match(events[3], /request_id=new/)
  await act(async () => view.unmount())
  assert.equal(listeners.size, 0)
})

test('card statuses distinguish stale data, cancelled requests, paused queues and latest export batches', () => {
  const modules = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } } })
  const { productionStatuses } = modules.get('elysium/production-ui')(() => React)
  const p = initialProduction({ brief: '阅读' })
  p.target_seconds = 15; p.story.scenes = sceneValues([{ id: 'scene-a', description: '阅读', duration: 15 }])
  p.segments = segmentValues([{ id: 'segment-1', scene_id: 'scene-a', description: '翻书', duration: 15 }], p)
  const s = p.segments[0]
  s.shots = [{ id: 'shot-1', duration: 15 }]; s.shots_revision = 0
  s.inputs = [{ id: 'input-1', source_revision: 0 }]; s.generations = [{ id: 'video-1', input_id: 'input-1', status: 'succeeded', url: 'https://video.example/1.mp4' }]
  assert.ok(Object.values(productionStatuses(p, null)).slice(0, 6).every(s => s.status === '已完成'))
  p.story.stale = true
  assert.equal(productionStatuses(p, null).segments.status, '未开始')
  p.story.stale = false; p.stage_runs = { shots: { status: 'cancelled' } }
  assert.equal(productionStatuses(p, null).shots.status, '已取消')
  p.queue = { status: 'paused', cursor: 0, items: [{}], error: '远端连接中断' }
  assert.equal(productionStatuses(p, null).videos.status, '已暂停')
  assert.match(productionStatuses(p, null).videos.detail, /远端连接中断/)
  p.exports = [{ id: 'old', batch_id: 'old', status: 'succeeded', timeline: { clips: [] } }, { id: 'new', batch_id: 'new', status: 'failed', error: '合片失败', timeline: { clips: [] } }]
  assert.equal(productionStatuses(p, null).compose.status, '生成失败')
  p.exports[1].status = 'running'
  assert.equal(productionStatuses(p, null).compose.status, '生成中')
  p.exports[1].status = 'interrupted'
  assert.equal(productionStatuses(p, null).compose.status, '已中断')
  assert.ok(!JSON.stringify(productionStatuses(p, null)).includes('待更新'))
})


test('project description edits and submits every displayed field', async () => {
  const modules = new Map(), cache = new Map(), calls = []
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } }, structuredClone, URL, URLSearchParams })
  const project = { id: '1234abcd', title: '书店', production: initialProduction({ brief: '原始故事' }) }
  cache.set('elysium/project-api', { fetchProject: async () => project, workflowAction: async (id, action, body) => { calls.push({ action, body }); return project } })
  cache.set('elysium/materials', { MaterialList: () => null })
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  let view
  await act(async () => { view = create(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project, busy: false, run: async fn => { await fn(); return true } })) })
  assert.equal(view.root.findByProps({ className: 'elysium-description-script' }).children.join(''), '无')
  const reference = '参考第一行\n参考第二行\n参考第三行'
  project.production.requirements = `当前要求\n\n参考剧情：\n${reference}`
  await act(async () => view.update(React.createElement(require('elysium/production-workflow').ProjectWorkflow, { project, busy: false, run: async fn => { await fn(); return true } })))
  assert.equal(view.root.findByProps({ className: 'elysium-description-script' }).children.join(''), reference)
  const fields = view.root.findByProps({ className: 'elysium-description-fields' })
  assert.deepEqual(fields.findAllByType('strong').map(n => n.children.join('')), ['标题：', '风格：', '画幅：', '目标总时长：', '剧本：'])
  assert.equal(fields.findAllByType('p')[0].findByType('span').children.join(''), '书店')
  assert.equal(fields.findAllByType('p').at(-1).findByType('span').children.join(''), reference)
  await act(async () => view.root.findAllByType('button').find(b => b.children.join('') === '编辑').props.onClick())
  for (const [label, value] of [['原始需求', '新的原始需求'], ['创作要求', '新的创作要求'], ['风格', '暖色写实'], ['画幅', '16:9'], ['目标总时长（秒）', '120']]) {
    await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
  }
  await act(async () => view.root.findAllByType('button').find(b => b.children.join('') === '保存').props.onClick())
  assert.equal(calls[0].action, 'production-description')
  for (const [key, value] of Object.entries({ original_request: '新的原始需求', requirements: '新的创作要求', style: '暖色写实', aspect_ratio: '16:9', target_seconds: 120 })) assert.equal(calls[0].body[key], value)
  await act(async () => view.unmount())
})


test('horizontal rails render every item without paging controls', async () => {
  const modules = new Map()
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } } })
  const { Rail } = modules.get('elysium/production-ui')(() => React)
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `item-${i}`, title: `片段 ${i + 1}` }))
  let view, opened
  await act(async () => { view = create(React.createElement(Rail, { label: 'Segment', items, open: item => { opened = item }, describe: item => item.title })) })
  assert.equal(view.root.findAllByType('button').length, 30)
  assert.equal(view.root.findAllByProps({ className: 'elysium-rail-controls' }).length, 0)
  assert.ok(!JSON.stringify(view.toJSON()).includes('加载更多'))
  await act(async () => view.root.findByProps({ 'aria-label': '打开Segment 30' }).props.onClick())
  assert.equal(opened, items[29])
  await act(async () => view.unmount())
})
