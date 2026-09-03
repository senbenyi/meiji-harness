import assert from 'node:assert/strict'
import test from 'node:test'
import { safeOutputFilename, safeOutputSegment } from '../../src/infrastructure/comfyui/engine.js'
import { isTrustedApiRequest } from '../../src/presentation/dsh/trust-fence.ts'

test('embedded ComfyUI routes share the plugin browser trust fence', () => {
  assert.equal(isTrustedApiRequest({ headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' } }, []), false)
  assert.equal(isTrustedApiRequest({ headers: { host: 'localhost:3000', origin: 'https://evil.example' } }, []), false)
  assert.equal(isTrustedApiRequest({ headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }, []), true)
  assert.equal(isTrustedApiRequest({ headers: { host: '192.168.0.10:3000', origin: 'http://192.168.0.10:3000' } }, ['192.168.0.10:3000']), true)
})

test('embedded ComfyUI output paths cannot escape the configured directory', () => {
  assert.equal(safeOutputSegment('prompt-123', 'prompt_id'), 'prompt-123')
  for (const value of ['', '.', '..', '../escape', '..\\escape', 'dir/file']) {
    assert.throws(() => safeOutputSegment(value, 'prompt_id'), error => error.code === 'OUTPUT_PATH_INVALID')
  }
  assert.equal(safeOutputFilename('../nested/result.png'), 'result.png')
  assert.equal(safeOutputFilename('..\\nested\\bad:name.png'), 'bad_name.png')
})
