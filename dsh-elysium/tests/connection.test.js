// 职责：验证 SSH 隧道只替换本插件记录的同端口旧连接。
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureConnection } from '../src/worker/models/catalog/transport.js'
import { withConfig } from '../src/config.js'

const backend = identity => ({ server_id: 'qwen', instance_id: 'gpu', deployment_id: 'one', connection: {
  transport: 'ssh', ssh_alias: 'veo-qwen38', ssh_identity: identity, remote_host: '127.0.0.1', remote_port: 8000, local_port: 18000,
} })

test('an owned stale tunnel is stopped before the replacement binds its port', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-tunnel-'))
  const legacyDirectory = join(directory, 'legacy')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const previous = join(directory, '18000-previous')
  await writeFile(previous, '')
  const calls = [], run = (_command, args) => {
    calls.push(args)
    if (args.includes('check')) return { status: args.includes(previous) ? 0 : 255 }
    return { status: 0 }
  }
  let checks = 0
  const result = await ensureConnection(backend('b'.repeat(64)), { directory, legacyDirectory, identity: () => 'b'.repeat(64), run,
    available: async () => { if (checks++ === 0) throw new Error('occupied') } })
  assert.equal(result.reused, false)
  assert.ok(calls.some(args => args.includes('exit') && args.includes(previous)))
  assert.equal(checks, 2)
  assert.deepEqual(await readdir(directory), [])
})

test('an unowned port conflict is preserved', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-tunnel-'))
  const legacyDirectory = join(directory, 'legacy')
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(ensureConnection(backend('b'.repeat(64)), { directory, legacyDirectory, identity: () => 'b'.repeat(64),
    run: () => ({ status: 255 }), available: async () => { throw new Error('external port owner') } }), /external port owner/)
})

test('a live matching control socket is reused without persistent metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-tunnel-'))
  const legacyDirectory = join(directory, 'legacy')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const result = await ensureConnection(backend('b'.repeat(64)), { directory, legacyDirectory, identity: () => 'b'.repeat(64),
    run: (_command, args) => ({ status: args.includes('check') ? 0 : assert.fail('must reuse') }),
    available: () => assert.fail('must not probe a reused port') })
  assert.equal(result.reused, true)
  assert.match(result.control, /\/18000-[a-f0-9]{20}$/)
  assert.deepEqual(await readdir(directory), [])
})

test('a live control with a stalled forward is replaced before reuse', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-tunnel-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls = [], run = (_command, args) => { calls.push(args); return { status: 0 } }
  const result = await ensureConnection({ ...backend('b'.repeat(64)), base_url: 'http://127.0.0.1:18000' }, {
    directory, legacyDirectory: join(directory, 'legacy'), identity: () => 'b'.repeat(64), run,
    healthy: async () => false, available: async () => {},
  })
  assert.equal(result.reused, false)
  assert.ok(calls.some(args => args.includes('exit')))
  assert.ok(calls.some(args => args.includes('-M')))
})

test('legacy runtime metadata is consumed without creating a replacement file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-tunnel-'))
  const directory = join(root, 'controls'), legacyDirectory = join(root, 'runtime', 'tunnels')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(legacyDirectory, { recursive: true })
  await writeFile(join(legacyDirectory, 'old.json'), JSON.stringify({ ssh_alias: 'old-qwen', local_port: 18000 }))
  await writeFile(join(legacyDirectory, 'old'), '')
  const calls = [], result = await ensureConnection(backend('b'.repeat(64)), { directory, legacyDirectory, identity: () => 'b'.repeat(64),
    run: (_command, args) => { calls.push(args); return { status: args.includes(join(legacyDirectory, 'old')) ? 0 : args.includes('-M') ? 0 : 255 } },
    available: async () => {} })
  assert.equal(result.reused, false)
  assert.ok(calls.some(args => args.includes('exit') && args.includes(join(legacyDirectory, 'old'))))
  await assert.rejects(access(legacyDirectory), error => error.code === 'ENOENT')
  assert.deepEqual(await readdir(directory), [])
})

test('default control path is short and leaves the persistent runtime clean', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-state-'))
  let controlDirectory
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    if (controlDirectory) await rm(controlDirectory, { recursive: true, force: true })
  })
  const result = await withConfig({ ELYSIUM_STATE_ROOT: root }, () => ensureConnection(backend('b'.repeat(64)), {
    identity: () => 'b'.repeat(64), run: () => ({ status: 0 }), available: () => assert.fail('must reuse'),
  }))
  controlDirectory = result.control.slice(0, result.control.lastIndexOf('/'))
  assert.ok(Buffer.byteLength(result.control) < 100)
  await assert.rejects(access(join(root, 'runtime', 'tunnels')), error => error.code === 'ENOENT')
  await assert.rejects(access(join(root, 'runtime', 'tunnels.json')), error => error.code === 'ENOENT')
})
