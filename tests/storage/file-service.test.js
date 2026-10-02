import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileService } from '../../lib/storage/files.js'
import { ProjectLease } from '../../lib/domain/lease.js'

test('FileService confines paths and atomically publishes content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-files-'))
  try {
    const files = await new FileService(root).initialize()
    const result = await files.atomicWrite('media/p/a.txt', 'hello')
    assert.equal(result.bytes, 5)
    assert.equal(await readFile(join(root, 'media/p/a.txt'), 'utf8'), 'hello')
    assert.throws(() => files.resolve('../escape.txt'), /escapes/)
    assert.throws(() => files.resolve('/tmp/escape.txt'), /relative/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ProjectLease gives one writer and a read-only second opener', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-lease-'))
  try {
    const files = await new FileService(root).initialize()
    const first = new ProjectLease(files, 'project-1', { ownerPid: process.pid, ownerHost: 'host-a' })
    const second = new ProjectLease(files, 'project-1', { ownerPid: process.pid + 1, ownerHost: 'host-b' })
    assert.equal((await first.acquire()).writable, true)
    assert.equal((await second.acquire()).writable, false)
    await first.release()
  } finally { await rm(root, { recursive: true, force: true }) }
})
