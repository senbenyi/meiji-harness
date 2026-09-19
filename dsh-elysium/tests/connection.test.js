// 职责：验证 SSH 隧道只替换本插件记录的同端口旧连接。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureConnection } from '../src/worker/models/managers/transport/connection.js'

const backend = identity => ({ server_id: 'qwen', instance_id: 'gpu', deployment_id: 'one', connection: {
  transport: 'ssh', ssh_alias: 'veo-qwen38', ssh_identity: identity, remote_host: '127.0.0.1', remote_port: 8000, local_port: 18000,
} })

test('an owned stale tunnel is stopped before the replacement binds its port', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-tunnel-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const previous = join(directory, 'previous')
  await writeFile(`${previous}.json`, JSON.stringify({ ssh_alias: 'old-qwen', ssh_identity: 'a'.repeat(64), local_port: 18000 }))
  const calls = [], run = (_command, args) => {
    calls.push(args)
    if (args.includes('check')) return { status: args.includes(previous) ? 0 : 255 }
    return { status: 0 }
  }
  let checks = 0
  const result = await ensureConnection(backend('b'.repeat(64)), { directory, identity: () => 'b'.repeat(64), run,
    available: async () => { if (checks++ === 0) throw new Error('occupied') } })
  assert.equal(result.reused, false)
  assert.ok(calls.some(args => args.includes('exit') && args.includes(previous)))
  assert.equal(checks, 2)
  assert.equal(JSON.parse(await readFile(`${result.control}.json`, 'utf8')).ssh_identity, 'b'.repeat(64))
})

test('an unowned port conflict is preserved', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-tunnel-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(ensureConnection(backend('b'.repeat(64)), { directory, identity: () => 'b'.repeat(64),
    run: () => ({ status: 255 }), available: async () => { throw new Error('external port owner') } }), /external port owner/)
})
