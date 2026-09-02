import assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { registerUploadedImage } from '../lib/lib/assets.js'
import { projectCreate } from '../lib/lib/project.js'
import { projectDir } from '../lib/lib/store.js'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])

test('stores a validated uploaded image inside project assets', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-toonflow-upload-test-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const config = { workspace }
  const created = await projectCreate(config, { title: '导入测试' })
  const projectId = created.project.id

  const relative = await registerUploadedImage(config, {
    projectId,
    scope: 'shots',
    entityId: 'shot-001',
    filename: 'frame.png',
    bytes: PNG,
  })

  assert.match(relative, /^assets\/shots\/shot-001-image-\d+\.png$/)
  assert.deepEqual(await readFile(path.join(projectDir(config, projectId), relative)), PNG)
})

test('rejects an image extension whose bytes do not match', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-toonflow-upload-test-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const config = { workspace }
  const created = await projectCreate(config, { title: '非法图片测试' })

  await assert.rejects(
    registerUploadedImage(config, {
      projectId: created.project.id,
      scope: 'characters',
      entityId: 'char-001',
      filename: 'fake.png',
      bytes: Buffer.from('not an image'),
    }),
    error => error.code === 'UNSUPPORTED_IMAGE' && error.status === 415,
  )
})
