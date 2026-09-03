import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { createComfyUiService, resolveComfyUiConfig } from '../../src/infrastructure/comfyui/service.js'

test('internal ComfyUI runtime seeds bundled workflows into the Elysium workspace', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))

  const runtime = resolveComfyUiConfig({ workspace, comfyui: { baseUrl: 'http://127.0.0.1:8189/' } })

  assert.equal(runtime.baseUrl, 'http://127.0.0.1:8189')
  assert.match(runtime.templatesDir, /elysium-comfyui-/)
  const contract = JSON.parse(await readFile(path.join(runtime.templatesDir, 'qwen-image-t2i.contract.json'), 'utf8'))
  assert.equal(contract.id, 'qwen-image-t2i')
})

test('internal ComfyUI settings persist without a second plugin', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-settings-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const service = createComfyUiService({ workspace, comfyui: { baseUrl: 'http://127.0.0.1:9' } })

  await service.saveSettings({ baseUrl: 'http://127.0.0.1:18189' })
  assert.equal(service.runtime().baseUrl, 'http://127.0.0.1:18189')
})

test('newer bundled contracts upgrade stale runtime templates together with their workflow', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-upgrade-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const config = { workspace, comfyui: { baseUrl: 'http://127.0.0.1:8189' } }
  const runtime = resolveComfyUiConfig(config)
  const contractPath = path.join(runtime.templatesDir, 'qwen-image-edit.contract.json')
  const workflowPath = path.join(runtime.templatesDir, 'qwen-image-edit.json')

  await writeFile(contractPath, JSON.stringify({ id: 'qwen-image-edit', _bundleVersion: 1, workflow: 'qwen-image-edit.json', slots: {} }))
  await writeFile(workflowPath, JSON.stringify({ stale: true }))
  resolveComfyUiConfig(config)

  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  const workflow = JSON.parse(await readFile(workflowPath, 'utf8'))
  assert.equal(contract._bundleVersion, 2)
  assert.equal(contract.slots.character_image.node, '14')
  assert.equal(workflow['14'].class_type, 'LoadImage')
  assert.equal(workflow.stale, undefined)
})
