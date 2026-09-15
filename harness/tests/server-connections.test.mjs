// 职责：用临时端口和模拟 SSH 验证连接归属，不连接真实服务器。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureConnection, portAvailable, sshIdentity } from '../../dsh-elysium/src/servers/transport/connection.js'
import { withConfig } from '../../dsh-elysium/src/config.js'
import { writeRegistry } from '../../dsh-elysium/src/servers/registry/store.js'
import { applyLlmSelection, installedYaml } from '../scripts/server-startup.mjs'

test('owned tunnel reuse, identity drift, port conflicts and disconnection preserve unrelated processes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ssh-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const backend = { server_id: 'a', connection: { transport: 'ssh', ssh_identity: 'a'.repeat(64), ssh_alias: 'fixture', remote_host: 'localhost', local_port: 19001, remote_port: 8188 } }
  const calls = [], owned = new Set()
  const run = (_cmd, args) => { calls.push(args); const control = args[args.indexOf('-S') + 1]; if (args.includes('check')) return { status: owned.has(control) ? 0 : 1 }; owned.add(control); return { status: 0 } }
  const options = { directory, identity: () => 'a'.repeat(64), available: async () => {}, run }
  const first = await ensureConnection(backend, options)
  assert.equal(first.reused, false)
  assert.equal((await ensureConnection(backend, options)).reused, true)
  const second = await ensureConnection({ ...backend, server_id: 'b', connection: { ...backend.connection, local_port: 19002 } }, options)
  assert.notEqual(first.control, second.control); assert.equal(owned.size, 2)
  assert.ok(calls.every(args => !args.includes('exit') && !args.includes('stop')))
  await assert.rejects(ensureConnection(backend, { ...options, identity: () => 'changed' }), /身份发生变化/)
  owned.clear()
  await assert.rejects(ensureConnection(backend, { ...options, available: async () => { throw new Error('端口冲突') } }), /端口冲突/)
  await assert.rejects(ensureConnection(backend, { ...options, run: () => ({ status: 255 }) }), /隧道建立失败/)
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  await assert.rejects(portAvailable(server.address().port), /已被占用/)
  const identity = sshIdentity('fixture', (_cmd, args) => { assert.deepEqual(args, ['-G', '--', 'fixture']); return 'hostname example\nuser test\nport 22\nidentityfile ~/.ssh/id\n' })
  assert.match(identity, /^[a-f0-9]{64}$/)
})

test('LLM selection only applies before startup, retains unrelated settings and uses credential references', async t => {
  let yaml
  try { yaml = installedYaml() } catch { t.skip('requires locally installed Harness yaml parser'); return }
  const home = await mkdtemp(join(tmpdir(), 'llm-start-')); t.after(() => rm(home, { recursive: true, force: true }))
  const source = await readFile(new URL('../.dsh/settings.yaml', import.meta.url), 'utf8')
  const path = join(home, 'settings.yaml'); await writeFile(path, source)
  await withConfig({ ELYSIUM_SERVERS_FILE: join(home, 'servers.json') }, async () => {
    await writeRegistry({ version: 1, revision: 0, active: { llm: 'text' }, servers: [{ id: 'text', label: 'Text', provider: 'manual', instance_id: 'text', deployment_id: 'one', connection_source: 'manual', services: { llm: { transport: 'http', base_url: 'http://model.test/v1', model: 'qwen3.8-27b-elysium', api_key_env: 'TEST_KEY' } } }] }, 0)
    await assert.rejects(applyLlmSelection(home, { yaml, processes: () => '123 node /opt/bin/dsh web --port 3081' }), /仍有 Harness/)
    assert.equal(await readFile(path, 'utf8'), source)
    assert.equal((await applyLlmSelection(home, { yaml, processes: () => '' })).server_id, 'text')
    const result = yaml.parse(await readFile(path, 'utf8')), original = yaml.parse(source)
    assert.equal(result['llm-pi-ai'].providers['qwen38-local'].baseURL, 'http://model.test/v1')
    assert.equal(result['llm-pi-ai'].providers['qwen38-local'].apiKeyEnv, 'TEST_KEY')
    assert.deepEqual(result.permission, original.permission)
    assert.deepEqual(result['llm-pi-ai'].providers['qwen-token-plan-cn'], original['llm-pi-ai'].providers['qwen-token-plan-cn'])
  })
})

test('reinstall preserves the actual server registry and credentials without running infrastructure commands', async t => {
  const { mkdir, copyFile, chmod } = await import('node:fs/promises')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const root = await mkdtemp(join(tmpdir(), 'server-install-')); t.after(() => rm(root, { recursive: true, force: true }))
  const scripts = join(root, 'harness/scripts'), source = join(root, 'harness/.dsh'), target = join(root, 'installed'), bin = join(root, 'bin')
  for (const directory of [scripts, join(source, 'storages/elysium/projects'), join(source, 'profiles/web'), target, bin, join(root, 'dsh-elysium')]) await mkdir(directory, { recursive: true })
  for (const name of ['install.mjs', 'storage-template.mjs']) await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(scripts, name))
  for (const name of ['servers.json', 'servers.example.json', '.credentials.yaml']) await writeFile(join(source, name), 'template must not overwrite')
  await copyFile(new URL('../.dsh/byteplus.example.json', import.meta.url), join(source, 'byteplus.example.json'))
  await writeFile(join(target, 'servers.json'), 'private registry')
  await writeFile(join(target, '.credentials.yaml'), 'private credential')
  for (const name of ['dsh', 'pnpm']) { const path = join(bin, name); await writeFile(path, '#!/bin/sh\nexit 0\n'); await chmod(path, 0o755) }
  const env = { ...process.env, DSH_HOME: target, PATH: bin }
  await promisify(execFile)(process.execPath, [join(scripts, 'install.mjs')], { env })
  assert.equal(JSON.parse(await readFile(join(target, 'byteplus.json'), 'utf8')).enabled, true)
  await writeFile(join(target, 'byteplus.json'), 'private third-party config')
  await promisify(execFile)(process.execPath, [join(scripts, 'install.mjs')], { env })
  assert.equal(await readFile(join(target, 'servers.json'), 'utf8'), 'private registry')
  assert.equal(await readFile(join(target, '.credentials.yaml'), 'utf8'), 'private credential')
  assert.equal(await readFile(join(target, 'byteplus.json'), 'utf8'), 'private third-party config')
  await assert.rejects(readFile(join(target, 'servers.example.json')), { code: 'ENOENT' })
})
