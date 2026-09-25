import test from 'node:test'
import assert from 'node:assert/strict'
import { shotSegments, shotSecondsReady } from '../client/shot-timing.js'
const content = { action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }
const shot = ranges => ({ duration: 6, seconds: ranges.map(range => ({ ...content, range })) })
test('time ranges cover the full shot without overlaps, gaps or oversized segments', () => {
  assert.equal(shotSecondsReady(shot(['0–5s', '5–6s'])), true)
  assert.equal(shotSecondsReady(shot(['0-3秒', '3-6秒'])), true)
  for (const ranges of [['0–6s'], ['0–3s', '4–6s'], ['0–4s', '3–6s'], ['1–5s'], ['0–5s'], ['0–0s', '0–5s', '5–6s']]) assert.equal(shotSecondsReady(shot(ranges)), false)
  assert.equal(shotSecondsReady({ duration: 2, seconds: [content, content] }), true)
  assert.equal(shotSegments(shot(['0–5s', '5–6s'])).length, 2)
})
