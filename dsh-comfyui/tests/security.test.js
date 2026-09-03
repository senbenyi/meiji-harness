import assert from 'node:assert/strict'
import test from 'node:test'
import { isTrustedSettingsRequest } from '../lib/index.js'
import { safeOutputFilename, safeOutputSegment } from '../lib/lib/engine.js'

test('settings API rejects cross-site browser requests', () => {
  assert.equal(isTrustedSettingsRequest({ headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(isTrustedSettingsRequest({ headers: { host: 'localhost:3000', origin: 'https://evil.example' } }), false)
  assert.equal(isTrustedSettingsRequest({ headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }), true)
  assert.equal(isTrustedSettingsRequest({ headers: { host: '192.168.0.10:3000', origin: 'http://192.168.0.10:3000' } }), true)
  assert.equal(isTrustedSettingsRequest({ headers: { host: 'localhost:3000' } }), true)
})

test('output path segments cannot escape the configured directory', () => {
  assert.equal(safeOutputSegment('prompt-123', 'prompt_id'), 'prompt-123')
  for (const value of ['', '.', '..', '../escape', '..\\escape', 'dir/file']) {
    assert.throws(() => safeOutputSegment(value, 'prompt_id'), error => error.code === 'OUTPUT_PATH_INVALID')
  }
  assert.equal(safeOutputFilename('../nested/result.png'), 'result.png')
  assert.equal(safeOutputFilename('..\\nested\\bad:name.png'), 'bad_name.png')
})
