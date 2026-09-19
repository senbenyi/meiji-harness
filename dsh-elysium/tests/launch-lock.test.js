import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { withLaunchLock } from '../src/worker/tasks/jobs/lock.js'
import { workerAlive } from '../src/worker/tasks/runtime/worker-owner.js'

test('launch lock rejects concurrent starts and serializes waiting sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-lock-'))
  let release
  const held = withLaunchLock(directory, () => new Promise(resolve => { release = resolve }))
  while (!release) await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(withLaunchLock(directory, async () => {}), error => error.code === 'WORKFLOW_RECOVERY_REQUIRED')
  let waited = false
  const waiting = withLaunchLock(directory, async () => { waited = true }, true)
  await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(waited, false)
  release(); await held; await waiting; assert.equal(waited, true)
})

test('launch lock reclaims a dead owner and removes its lock directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'elysium-lock-')), lock = join(directory, 'launch.lock')
  await mkdir(lock); await writeFile(join(lock, 'owner'), '999999999:stale')
  let called = false
  await withLaunchLock(directory, async () => { called = true })
  assert.equal(called, true); await assert.rejects(access(lock))
})

test('worker identity reads the complete command line after a long script path', async t => {
  const directory = await mkdtemp(join(tmpdir(), `elysium-${'x'.repeat(100)}-`)), runtime = join(directory, 'worker', 'tasks', 'runtime')
  const script = join(runtime, 'worker.js'), lock = join(directory, 'worker.lock'), jobId = 'a'.repeat(32)
  await mkdir(runtime, { recursive: true }); await writeFile(script, 'setInterval(() => {}, 1000)')
  const child = spawn(process.execPath, [script, 'abcd1234', jobId], { stdio: 'ignore' })
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  t.after(async () => { try { child.kill('SIGTERM') } catch {}; await rm(directory, { recursive: true, force: true }) })
  await writeFile(lock, String(child.pid))
  assert.equal(await workerAlive(lock, jobId), true)
})
