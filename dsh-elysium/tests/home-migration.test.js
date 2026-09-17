// 职责：验证旧 Harness 业务数据可非覆盖迁移到独立 Elysium Home。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execute = promisify(execFile)

test('migration separates connections, selection, providers and state without overwriting targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-migration-')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'dsh'), target = join(root, 'elysium'), state = join(source, 'storages', 'elysium')
  await mkdir(join(state, 'projects', 'old'), { recursive: true })
  await writeFile(join(state, 'projects', 'old', 'project.json'), '{}')
  await writeFile(join(source, 'servers.json'), JSON.stringify({ version: 1, revision: 7, active: { comfyui: 'video-a', image: 'image-a' }, third_party: { video: 'channel:model' }, servers: [] }))
  await writeFile(join(source, 'bailian.json'), '{"enabled":false}')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'directors.json'), 'keep')
  const script = new URL('../scripts/migrate-home.mjs', import.meta.url)
  await execute(process.execPath, [script.pathname], { env: { ...process.env, DSH_HOME: source, ELYSIUM_HOME: target } })
  const registry = JSON.parse(await readFile(join(target, 'servers.json'), 'utf8'))
  const selection = JSON.parse(await readFile(join(target, 'config.json'), 'utf8'))
  assert.equal(registry.active, undefined); assert.equal(registry.third_party, undefined)
  assert.deepEqual(selection.selected, { image: 'image-a', video: 'video-a' })
  assert.deepEqual(selection.third_party, { video: 'channel:model' })
  assert.equal(await readFile(join(target, 'directors.json'), 'utf8'), 'keep')
  assert.equal(await readFile(join(target, 'projects', 'old', 'project.json'), 'utf8'), '{}')
  assert.equal(await readFile(join(target, 'providers', 'bailian.json'), 'utf8'), '{"enabled":false}')
  await writeFile(join(target, 'config.json'), 'keep')
  await execute(process.execPath, [script.pathname], { env: { ...process.env, DSH_HOME: source, ELYSIUM_HOME: target } })
  assert.equal(await readFile(join(target, 'config.json'), 'utf8'), 'keep')
  assert.equal(await readFile(join(source, 'servers.json'), 'utf8').then(JSON.parse).then(value => value.active.comfyui), 'video-a')
})
