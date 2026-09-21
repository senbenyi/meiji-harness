// 职责：验证旧导演迁移的预演、项目引用转换、归档和重跑幂等。
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const run = promisify(execFile)
const script = new URL('../scripts/migrate-directors.mjs', import.meta.url).pathname

test('director migration previews, archives legacy data and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-director-migration-'))
  try {
    await mkdir(join(root, 'pools'), { recursive: true })
    await mkdir(join(root, 'projects', '1234abcd'), { recursive: true })
    await writeFile(join(root, 'pools', 'directors.json'), JSON.stringify([{ name: '导演甲', style: '暖色长镜头', works: ['作品 A'] }]))
    await writeFile(join(root, 'projects', '1234abcd', 'project.json'), JSON.stringify({ id: '1234abcd', director: '导演甲', updated_at: 1 }))
    const execute = async (...args) => JSON.parse((await run(process.execPath, [script, ...args], { env: { ...process.env, ELYSIUM_STATE_ROOT: root } })).stdout)
    assert.deepEqual(await execute('--dry-run'), { directors: 1, projects: 1, dry_run: true })
    assert.equal(JSON.parse(await readFile(join(root, 'projects', '1234abcd', 'project.json'))).director, '导演甲')
    assert.deepEqual(await execute(), { directors: 1, projects: 1, dry_run: false })
    const skill = await readFile(join(root, 'pools', 'skills', 'director-001', 'SKILL.md'), 'utf8')
    assert.match(skill, /暖色长镜头/)
    assert.match(await readFile(join(root, 'pools', 'skills', 'director-001', 'references', 'works.md'), 'utf8'), /作品 A/)
    assert.equal(JSON.parse(await readFile(join(root, 'projects', '1234abcd', 'project.json'))).director, 'director-001')
    assert.equal((await readdir(join(root, 'runtime', 'migrations'))).length, 1)
    assert.deepEqual(await execute(), { directors: 0, projects: 0, already_migrated: true, dry_run: false })
    assert.equal((await readdir(join(root, 'runtime', 'migrations'))).length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
