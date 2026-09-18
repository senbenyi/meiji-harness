// 职责：验证旧目录和混合配置无损迁入五类目录并可恢复。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execute = promisify(execFile)

test('migration creates five roots, splits config, preserves projects and archives old writers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-migration-')); t.after(() => rm(root, { recursive: true, force: true }))
  const dsh = join(root, 'dsh'), source = join(root, '.elysium'), target = join(dsh, 'storages', 'elysium')
  await mkdir(join(source, 'projects', 'old'), { recursive: true })
  await writeFile(join(source, 'projects', 'old', 'project.json'), '{}')
  await writeFile(join(source, 'directors.json'), 'legacy')
  await mkdir(join(target, 'projects', 'keep'), { recursive: true })
  await writeFile(join(target, 'projects', 'keep', 'project.json'), '{"keep":true}')
  await mkdir(join(target, 'pools'), { recursive: true })
  await writeFile(join(target, 'pools', 'directors.json'), 'current')
  await mkdir(join(target, 'config'), { recursive: true })
  await writeFile(join(target, 'config', 'servers.json'), JSON.stringify({ version: 1, revision: 7, active: { comfyui: 'video-a', image: 'image-a' }, third_party: { video: 'channel:model' }, servers: [] }))
  await writeFile(join(target, 'config', 'bailian.json'), '{"enabled":false}')
  const script = new URL('../scripts/migrate-home.mjs', import.meta.url)
  await execute(process.execPath, [script.pathname], { env: { ...process.env, DSH_HOME: dsh, ELYSIUM_LEGACY_HOME: source } })

  assert.deepEqual((await readdir(target)).filter(name => !name.startsWith('.')).sort(), ['config', 'pools', 'projects', 'runtime', 'uploads'])
  const registry = JSON.parse(await readFile(join(target, 'config', 'servers.json'), 'utf8'))
  const selection = JSON.parse(await readFile(join(target, 'config', 'selection.json'), 'utf8'))
  assert.equal(registry.active, undefined); assert.equal(registry.third_party, undefined)
  assert.deepEqual(selection.selected, { image: 'image-a', video: 'video-a' })
  assert.deepEqual(selection.third_party, { video: 'channel:model' })
  assert.equal(await readFile(join(target, 'pools', 'directors.json'), 'utf8'), 'current')
  assert.equal(await readFile(join(target, 'projects', 'keep', 'project.json'), 'utf8'), '{"keep":true}')
  assert.equal(await readFile(join(target, 'projects', 'old', 'project.json'), 'utf8'), '{}')
  assert.equal(await readFile(join(target, 'config', 'providers', 'bailian.json'), 'utf8'), '{"enabled":false}')
  assert.equal((await stat(join(target, 'config', 'providers', 'bailian.json'))).mode & 0o777, 0o600)
  await assert.rejects(access(source), { code: 'ENOENT' })
  await assert.rejects(access(join(target, 'config', 'bailian.json')), { code: 'ENOENT' })
  const migrations = await readdir(join(target, 'runtime', 'migrations'))
  assert.equal(migrations.length, 1)
  const backup = join(target, 'runtime', 'migrations', migrations[0])
  assert.equal(await readFile(join(backup, 'legacy-home', 'directors.json'), 'utf8'), 'legacy')
  assert.equal(await readFile(join(backup, 'legacy-config', 'bailian.json'), 'utf8'), '{"enabled":false}')
  assert.match(await readFile(join(backup, 'original-config', 'servers.json'), 'utf8'), /third_party/)

  await writeFile(join(target, 'config', 'selection.json'), 'keep')
  await execute(process.execPath, [script.pathname], { env: { ...process.env, DSH_HOME: dsh, ELYSIUM_LEGACY_HOME: source } })
  assert.equal(await readFile(join(target, 'config', 'selection.json'), 'utf8'), 'keep')
})
