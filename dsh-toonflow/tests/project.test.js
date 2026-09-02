import assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  projectCreate,
  projectDelete,
  projectGet,
  projectList,
} from '../lib/lib/project.js'
import { projectDir, resolveProjectFile } from '../lib/lib/store.js'

async function fixture(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-toonflow-test-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  return { workspace }
}

test('creates, lists, reads, and deletes an empty project', async (t) => {
  const config = await fixture(t)
  const created = await projectCreate(config, { title: '测试短剧', description: 'Phase 2' })
  const id = created.project.id

  assert.match(id, /^project-[a-z0-9-]+$/)
  assert.equal((await projectList(config)).projects[0].title, '测试短剧')

  const loaded = await projectGet(config, { projectId: id })
  assert.deepEqual(loaded.characters, [])
  assert.deepEqual(loaded.scenes, [])
  assert.deepEqual(loaded.shots, [])

  const dir = projectDir(config, id)
  for (const relative of [
    'project.json', 'characters.json', 'scenes.json', 'shots.json',
    'assets/characters', 'assets/scenes', 'assets/shots', 'output',
  ]) {
    await assert.doesNotReject(() => readFile(path.join(dir, relative)).catch(error => {
      if (error.code === 'EISDIR') return Buffer.alloc(0)
      throw error
    }))
  }

  await projectDelete(config, { projectId: id })
  assert.deepEqual((await projectList(config)).projects, [])
})

test('serves only existing files contained by the selected project', async (t) => {
  const config = await fixture(t)
  const created = await projectCreate(config, { title: '媒体测试' })
  const id = created.project.id
  const dir = projectDir(config, id)
  const mediaDir = path.join(dir, 'assets', 'characters')
  await mkdir(mediaDir, { recursive: true })
  await writeFile(path.join(mediaDir, 'hero.png'), 'png')

  assert.equal(
    await resolveProjectFile(config, id, 'assets/characters/hero.png'),
    await realpath(path.join(mediaDir, 'hero.png')),
  )
  await assert.rejects(
    () => resolveProjectFile(config, id, '../project.json'),
    error => error.code === 'INVALID_PATH',
  )
  await assert.rejects(
    () => projectGet(config, { projectId: '../../escape' }),
    error => error.code === 'INVALID_PROJECT_ID',
  )
})
