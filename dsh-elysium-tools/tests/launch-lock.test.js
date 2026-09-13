import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { withLaunchLock } from '../src/jobs/launch.js'

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
