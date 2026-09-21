import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const settings = await readFile(new URL('../.dsh/settings.yaml', import.meta.url), 'utf8')
const profile = await readFile(new URL('../.dsh/profiles/web/cordis.patch.yml', import.meta.url), 'utf8')
const ignore = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8')

test('Harness settings contain runtime values without composition controls', () => {
  assert.match(settings, /baseURL: http:\/\/43\.154\.247\.11\/qwen\/v1/)
  assert.match(settings, /apiKeyEnv: QWEN38_LOCAL_API_KEY/)
  assert.doesNotMatch(settings, /^\s+apiKey:/m)
  assert.match(settings, /default: elysium-free/)
  assert.doesNotMatch(settings, /includeShippedRoot/)
  assert.doesNotMatch(settings, /^\s*(?:-\s+)?(?:insert|disabled|isolate):/m)
  assert.doesNotMatch(settings, /__[A-Z0-9_]+__|harness-runtime:|harness-customization:/)
})

test('Web profile keeps plugin assembly and capability controls explicit', () => {
  assert.match(profile, /id: command-feedback\s+disabled: true/)
  assert.match(profile, /id: session-log-download\s+disabled: true/)
  assert.match(profile, /id: permission\s+isolate:\s+commands: true/)
  assert.match(profile, /id: ui-permission\s+disabled: true/)
  assert.match(profile, /id: agent-presets\s+config:\s+default: elysium-free\s+includeShippedRoot: false/)
  assert.match(profile, /name: '@dsh-external\/dsh-elysium'/)
  assert.doesNotMatch(profile, /comfyUrl|models:|ELYSIUM_|COMFYUI_URL/)
  assert.doesNotMatch(profile, /maxResponseTokens|proxy\.runpod\.net/)
})

test('repository excludes generated credentials and does not ship a Harness env file', async () => {
  assert.match(ignore, /harness\/\.dsh\/\.credentials\.yaml/)
  await assert.rejects(access(new URL('../.dsh/.credentials.yaml', import.meta.url)))
  await assert.rejects(access(new URL('../.dsh/.env.example', import.meta.url)))
})
