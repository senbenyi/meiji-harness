import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { clientSource } from '../scripts/client-source.mjs'

async function fixture(responses, block = {}) {
  const bundles = new Map(), cache = new Map(), timers = new Map(), requests = [], slots = []
  let sequence = 0
  runInNewContext(clientSource(), { window: { __ELYSIUM_MEDIA__: { token: 'test', base: '/plugins/dsh-elysium/media' },
    __ModuleLoader__: { load: item => bundles.set(item.id, item.factory) } },
    URLSearchParams, AbortController, structuredClone,
    setTimeout: run => { const id = ++sequence; timers.set(id, run); return id }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options })
      const value = responses.shift()
      if (value instanceof Error) throw value
      return { ok: !value.httpError, status: value.httpError || 200, json: async () => value }
    },
  })
  const require = name => {
    if (name === 'react') return React
    if (!cache.has(name)) cache.set(name, bundles.get(name)(require))
    return cache.get(name)
  }
  require('elysium-ui/media-card').apply({ slots: { inject: (_, run) => run(), register: (spec, component) => slots.push({ spec, component }) } })
  assert.deepEqual(slots.map(s => s.spec.key), ['workflow_generate_video', 'workflow_resume_video'])
  let view
  await act(async () => { view = create(React.createElement(slots[0].component, { sessionId: 'session', callId: 'call', block })) })
  return { view, requests, timers,
    tick: async () => act(async () => { const [id, run] = timers.entries().next().value; timers.delete(id); await run() }),
    close: async () => act(async () => view.unmount()) }
}

test('same card progresses to playable result and stops polling', async () => {
  const f = await fixture([{ status: 'running', stage: 'generate' }, { status: 'succeeded', has_video: true,
    job_id: 'a', media_info: { duration_seconds: 8, width: 640, height: 384, frame_rate: 24 }, validation: { full_decode: 'passed', specification_match: 'passed', human_review: 'not_run' } }])
  try {
    assert.match(f.view.root.findByProps({ role: 'status' }).children.join(''), /生成视频/)
    await f.tick()
    const video = f.view.root.findByType('video')
    assert.match(video.props.src, /^\/plugins\/dsh-elysium\/media\/video\?/)
    assert.equal(video.props.controls, true)
    assert.ok(!video.props.src.includes('3080'))
    assert.match(f.view.root.findByType('a').props.href, /download=1/)
    assert.equal(f.timers.size, 0)
    assert.match(JSON.stringify(f.view.toJSON()), /尚未人工验收/)
    assert.equal(f.requests.length, 2)
  } finally { await f.close() }
})
test('refresh can recover a completed job even when the tool block is still running', async () => {
  const f = await fixture([{ status: 'succeeded', has_video: true }])
  try { assert.equal(f.view.root.findAllByType('video').length, 1); assert.equal(f.timers.size, 0) }
  finally { await f.close() }
})
test('network interruption reconnects, whereas expired credentials stop polling', async () => {
  const f = await fixture([new Error('disconnected'), { httpError: 401, error: '请刷新页面' }])
  try {
    assert.match(JSON.stringify(f.view.toJSON()), /disconnected/)
    await f.tick()
    assert.match(JSON.stringify(f.view.toJSON()), /请刷新页面/)
    assert.equal(f.timers.size, 0)
  } finally { await f.close() }
})
test('failed production stays failed and does not trigger generation or claim success', async () => {
  const f = await fixture([{ status: 'failed', job_id: 'job', error: 'generation failed' }])
  try {
    assert.match(JSON.stringify(f.view.toJSON()), /generation failed/)
    assert.equal(f.view.root.findAllByType('video').length, 0)
    assert.equal(f.timers.size, 0)
    assert.ok(f.requests.every(r => r.url.includes('/status?')))
  } finally { await f.close() }
})
test('unmount aborts the request and removes pending polling timers', async () => {
  const f = await fixture([{ status: 'running' }])
  assert.equal(f.timers.size, 1)
  await f.close()
  assert.equal(f.timers.size, 0)
  assert.equal(f.requests[0].options.signal.aborted, true)
})
