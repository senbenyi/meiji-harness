import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url).pathname
const localScript = name => readFile(join(root, 'harness/scripts', name), 'utf8')
const serverScript = name => readFile(join(root, 'runpod/scripts', name), 'utf8')

test('local scripts install and start Harness without invoking server operations', async () => {
  const install = await localScript('install.mjs'), start = await localScript('start.mjs')
  assert.match(install, /pnpm.*@deepseek-ai\/dsh/s)
  assert.match(install, /package:registry/)
  assert.match(install, /pnpm.*add.*--workspace-root.*registry/s)
  assert.match(install, /entry === '\.credentials\.yaml'/)
  assert.match(install, /entry === '\.env\.example'/)
  assert.match(install, /chmod\(sensitiveFile, 0o600\)/)
  assert.match(start, /execFileSync\('dsh', \['web'\]/)
  for (const source of [install, start]) assert.doesNotMatch(source, /comfyui\.mjs|tunnel\.mjs|ssh|system_stats/)
})

test('server scripts expose only their explicit ComfyUI and Qwen commands', async () => {
  const comfyui = await serverScript('comfyui.mjs'), tunnel = await serverScript('tunnel.mjs')
  for (const action of ['check', 'start', 'stop', 'restart']) assert.match(comfyui, new RegExp(`case '${action}'`))
  assert.match(comfyui, /const root = '\/workspace\/runpod-slim'/)
  assert.match(comfyui, /join\(root, 'ComfyUI'\)/)
  assert.match(tunnel, /target !== 'qwen'/)
  assert.match(tunnel, /127\.0\.0\.1:18000:127\.0\.0\.1:8000/)
})
