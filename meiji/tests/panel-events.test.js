import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { createPanelEvents } from '../client/panel-events.js'

test('hidden tabs release streams, visibility reconnects and pagehide disposes', t => {
  const dom = new JSDOM('', { pretendToBeVisual: true }); t.after(() => dom.window.close())
  const document = dom.window.document, sources = []
  let hidden = false, refreshed = 0, messages = 0
  Object.defineProperty(document, 'hidden', { get: () => hidden })
  class Source { constructor(url) { this.url = url; this.readyState = 1; sources.push(this) } close() { this.closed = true } }
  const events = createPanelEvents({ document, EventSource: Source, onResume: () => refreshed++ })
  events.watch('/one', () => messages++)
  events.watch('/one', () => messages++)
  assert.equal(sources.length, 1)
  hidden = true; document.dispatchEvent(new dom.window.Event('visibilitychange'))
  assert.equal(sources[0].closed, true)
  sources[0].onmessage({})
  assert.equal(messages, 0)
  hidden = false; document.dispatchEvent(new dom.window.Event('visibilitychange'))
  assert.equal(sources.length, 2)
  assert.equal(refreshed, 1)
  sources[1].onmessage({}); assert.equal(messages, 1)
  events.pause(); assert.equal(sources[1].closed, true)
  document.dispatchEvent(new dom.window.Event('visibilitychange'))
  assert.equal(sources.length, 2)
  events.resume(); assert.equal(sources.length, 3)
  events.watch('/two', () => messages++)
  assert.equal(sources[2].closed, true)
  assert.equal(sources[3].url, '/two')
  events.watch('', () => {}); assert.equal(sources[3].closed, true)
  assert.equal(events.connected(), false)
  events.watch('/two', () => {})
  dom.window.dispatchEvent(new dom.window.Event('pagehide'))
  assert.equal(sources[4].closed, true)
  events.resume(); assert.equal(sources.length, 5)
})
