import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const migrationScript = join(repositoryRoot, 'scripts/tools/migrate-project-layout.mjs')

test('project layout migration merges canvas, retargets bindings, and keeps recoverable backups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-layout-migration-'))
  const storage = join(root, 'storage')
  const workspace = join(root, 'workspace')
  const oldProjectId = 'old-project'
  const oldCanvasId = 'old-canvas'
  const targetId = '20261002213427144'
  const sourceKey = `source/${oldProjectId}/source.txt`
  const canvasKey = 'canvas/session-a/outline.pdf'
  try {
    await write(join(storage, 'projects', `${oldProjectId}.json`), {
      version: 3,
      record: {
        id: oldProjectId,
        title: '穿越王妃',
        createdAt: '2026-10-02T13:34:27.144Z',
        sourceDocuments: { source: { id: 'source', title: '完整剧本', logicalKey: sourceKey } },
        legacyCanvas: null,
      },
    })
    await write(join(storage, 'projects', `${oldCanvasId}.json`), {
      version: 1,
      record: {
        id: oldCanvasId,
        legacyCanvas: {
          sessionId: 'session-a',
          nodes: [{ id: 'random-id', kind: 'text', title: '分集大纲', group: 'outline', file: canvasKey }],
        },
      },
    })
    const bindingFile = join(storage, 'bindings', 'canvas-hash.json')
    await write(bindingFile, { version: 2, record: { bindingKey: 'canvas-hash', projectId: oldCanvasId, source: 'session' } })
    await write(join(workspace, sourceKey), '剧本正文')
    await write(join(workspace, canvasKey), 'pdf bytes')

    const common = [`--project=${oldProjectId}`, `--canvas-project=${oldCanvasId}`, `--target=${targetId}`, `--storage=${storage}`, `--workspace=${workspace}`]
    const preview = await execute(process.execPath, [migrationScript, ...common])
    assert.match(preview.stdout, /"mode": "dry-run"/)
    await assert.rejects(stat(join(storage, 'projects', `${targetId}.json`)))

    await execute(process.execPath, [migrationScript, ...common, '--offline', '--apply'])
    const migrated = JSON.parse(await readFile(join(storage, 'projects', `${targetId}.json`), 'utf8')).record
    assert.equal(migrated.id, targetId)
    assert.match(migrated.sourceDocuments.source.logicalKey, /^projects\/20261002213427144\/step-01-source\/step-01-source-001-完整剧本-v001\.txt$/)
    assert.match(migrated.legacyCanvas.nodes[0].file, /^projects\/20261002213427144\/step-03-episode-plan\/step-03-分集大纲-v001\.pdf$/)
    assert.equal((JSON.parse(await readFile(bindingFile, 'utf8'))).record.projectId, targetId)
    await assert.rejects(stat(join(storage, 'projects', `${oldProjectId}.json`)))
    await assert.rejects(stat(join(storage, 'projects', `${oldCanvasId}.json`)))
    await assert.rejects(stat(join(workspace, 'source', oldProjectId)))
    await assert.rejects(stat(join(workspace, 'canvas', 'session-a')))
    const trash = join(storage, 'trash')
    assert.ok((await stat(trash)).isDirectory())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function write(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const data = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  await writeFile(file, data)
}
