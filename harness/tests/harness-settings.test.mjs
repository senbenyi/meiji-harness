import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const settings = await readFile(new URL('../harness/.dsh/settings.yaml', import.meta.url), 'utf8')

test('Harness settings are directly deployable without render-only sections', () => {
  assert.match(settings, /baseURL: http:\/\/127\.0\.0\.1:18000\/v1/)
  assert.match(settings, /default: elysium-teaching/)
  assert.doesNotMatch(settings, /__[A-Z0-9_]+__|harness-runtime:|harness-customization:/)
})
