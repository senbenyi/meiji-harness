import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileService } from '../../lib/storage/files.js'
import { AuditLog, verifyAuditLines } from '../../lib/diagnostics/audit.js'

test('audit hash chain detects modification and emits signed checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
  try {
    const files = await new FileService(root).initialize()
    const audit = await new AuditLog(files, { checkpointKey: 'test-key' }).load()
    await audit.append({ actor: 'user', action: 'approve', target: 'asset-1', revision: 2 })
    await audit.append({ actor: 'agent', action: 'export', target: 'timeline-1', revision: 3 })
    const lines = (await files.readText('audit.ndjson')).trim().split('\n')
    assert.equal(verifyAuditLines(lines).valid, true)
    const changed = JSON.parse(lines[0]); changed.action = 'reject'; lines[0] = JSON.stringify(changed)
    assert.equal(verifyAuditLines(lines).valid, false)
    assert.equal(audit.checkpoint().seq, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
