// 职责：验证旧 Harness 业务数据可非覆盖迁移到独立 Elysium Home。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execute = promisify(execFile)

test('migration merges legacy home into DSH storage, backs up conflicts and keeps target-only data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-migration-')); t.after(() => rm(root, { recursive: true, force: true }))
  const dsh = join(root, 'dsh'), source = join(root, '.elysium'), target = join(dsh, 'storages', 'elysium')
  await mkdir(join(source, 'projects', 'old'), { recursive: true })
  await writeFile(join(source, 'projects', 'old', 'project.json'), '{}')
  await writeFile(join(source, 'directors.json'), 'latest')
  await mkdir(join(target, 'projects', 'keep'), { recursive: true })
  await writeFile(join(target, 'projects', 'keep', 'project.json'), '{"keep":true}')
  await writeFile(join(target, 'directors.json'), 'previous')
  await writeFile(join(dsh, 'servers.json'), JSON.stringify({ version: 1, revision: 7, active: { comfyui: 'video-a', image: 'image-a' }, third_party: { video: 'channel:model' }, servers: [] }))
  await writeFile(join(dsh, 'bailian.json'), '{"enabled":false}')
  const script = new URL('../scripts/migrate-home.mjs', import.meta.url)
  await execute(process.execPath, [script.pathname], { env: { ...process.env, DSH_HOME: dsh, ELYSIUM_LEGACY_HOME: source } })
  const registry = JSON.parse(await readFile(join(target, 'servers.json'), 'utf8'))
  const selection = JSON.parse(await readFile(join(target, 'config.json'), 'utf8'))
  assert.equal(registry.active, undefined); assert.equal(registry.third_party, undefined)
  assert.deepEqual(selection.selected, { image: 'image-a', video: 'video-a' })
  assert.deepEqual(selection.third_party, { video: 'channel:model' })
  assert.equal(await readFile(join(target, 'directors.json'), 'utf8'), 'latest')
  assert.equal(await readFile(join(target, 'projects', 'keep', 'project.json'), 'utf8'), '{"keep":true}')
  assert.equal(await readFile(join(target, 'projects', 'old', 'project.json'), 'utf8'), '{}')
  assert.equal(await readFile(join(target, 'providers', 'bailian.json'), 'utf8'), '{"enabled":false}')
  assert.equal((await stat(join(target, 'providers', 'bailian.json'))).mode & 0o777, 0o600)
  const backups = await readdir(join(target, '.migration-backups'))
  assert.equal(backups.length, 1)
  assert.equal(await readFile(join(target, '.migration-backups', backups[0], 'directors.json'), 'utf8'), 'previous')
  await writeFile(join(target, 'config.json'), 'keep')
  await execute(process.execPath, [script.pathname], { env: { ...process.env, DSH_HOME: dsh, ELYSIUM_LEGACY_HOME: source } })
  assert.equal(await readFile(join(target, 'config.json'), 'utf8'), 'keep')
  assert.equal(await readFile(join(dsh, 'servers.json'), 'utf8').then(JSON.parse).then(value => value.active.comfyui), 'video-a')
})
