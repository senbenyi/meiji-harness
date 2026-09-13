import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const settings = await readFile(new URL('../.dsh/settings.yaml', import.meta.url), 'utf8')
const profile = await readFile(new URL('../.dsh/profiles/web/cordis.patch.yml', import.meta.url), 'utf8')
const ignore = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8')

test('Harness settings are directly deployable without render-only sections', () => {
  assert.match(settings, /baseURL: http:\/\/127\.0\.0\.1:18000\/v1/)
  assert.match(settings, /default: elysium-teaching/)
  assert.doesNotMatch(settings, /__[A-Z0-9_]+__|harness-runtime:|harness-customization:/)
})

test('Web profile keeps runtime addresses and disabled commands explicit', () => {
  assert.match(profile, /id: command-feedback\s+disabled: true/)
  assert.match(profile, /id: session-log-download\s+disabled: true/)
  assert.match(profile, /id: permission\s+isolate:\s+commands: true/)
  assert.match(profile, /id: ui-permission\s+disabled: true/)
  assert.match(profile, /comfyUrl: !!js process\.env\.COMFYUI_URL/)
  assert.doesNotMatch(profile, /maxResponseTokens|proxy\.runpod\.net/)
})

test('repository excludes generated credentials and provides only an environment template', async () => {
  assert.match(ignore, /harness\/\.dsh\/\.credentials\.yaml/)
  await assert.rejects(access(new URL('../.dsh/.credentials.yaml', import.meta.url)))
  await access(new URL('../.dsh/.env.example', import.meta.url))
})
