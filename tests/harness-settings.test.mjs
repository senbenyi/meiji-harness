import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const root = new URL('../', import.meta.url).pathname
const loader = join(root, 'app/common/config_loader.sh')
const config = join(root, 'harness/config/settings.yaml')
const run = (mode, path = config) => spawnSync('bash', [loader, mode, path], { encoding: 'utf8' })

test('shell mode exports local Harness, RunPod and Qwen settings', () => {
  const result = run('shell')
  assert.equal(result.status, 0, result.stderr)
  for (const key of ['LOCAL_DSH_HOME', 'LOCAL_HARNESS_PORT', 'COMFYUI_URL', 'QWEN_SSH_TARGET']) assert.match(result.stdout, new RegExp(`^${key}=`, 'm'))
  for (const key of ['COMFYUI_SSH_TARGET', 'HARNESS_ROOT', 'HARNESS_SSH_TARGET', 'PLUGINS_ROOT']) assert.doesNotMatch(result.stdout, new RegExp(`^${key}=`, 'm'))
})

test('render mode targets local Qwen and removes private sections', () => {
  const result = run('render')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /http:\/\/127\.0\.0\.1:18000\/v1/)
  assert.doesNotMatch(result.stdout, /^(harness-runtime|harness-customization):|__QWEN_/m)
  assert.match(result.stdout, /defaultPreset: danger-full-access/)
})

test('profile mode renders only project-owned web profile overrides', () => {
  const result = run('profile')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^# 禁用命令执行反馈组件。\n- id: command-feedback/m)
  assert.match(result.stdout, /comfyUrl: https:\/\/36we4j3zo503js-8188\.proxy\.runpod\.net/)
  assert.doesNotMatch(result.stdout, /harness-customization|harness-runtime|publicUrl|__COMFYUI_URL__/)
})

test('required URL, port and local path values are validated', async () => {
  const source = await readFile(config, 'utf8'), directory = await mkdtemp(join(tmpdir(), 'elysium-settings-'))
  for (const key of ['COMFYUI_URL', 'LOCAL_HARNESS_PORT', 'LOCAL_DSH_HOME']) {
    const path = join(directory, `${key}.yaml`)
    await writeFile(path, source.replace(new RegExp(`^(  ${key}:).*$`, 'm'), `$1 `))
    assert.notEqual(run('shell', path).status, 0)
  }
})
