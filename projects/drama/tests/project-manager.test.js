import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectManager } from '../src/index.js'

async function fixture(project = { basic_info: { id: 'project_001', name: '原名称' } }) {
  const dir = await mkdtemp(join(tmpdir(), 'drama-project-'))
  const file = join(dir, 'project.json')
  await writeFile(file, `${JSON.stringify(project, null, 2)}\n`)
  return { dir, file }
}

test('打开项目后，改数据留在内存，update 才写入本地 JSON', async () => {
  const { dir, file } = await fixture()
  try {
    const manager = await ProjectManager.open(file)
    const before = await readFile(file, 'utf8')
    const saved = manager.change((project) => {
      project.basic_info.name = '新名称'
      project.story_segments = { output: { segments: [{ id: 'segment_001' }] } }
    })
    assert.equal(saved.basic_info.name, '新名称')
    assert.equal(manager.read().story_segments.output.segments[0].id, 'segment_001')
    assert.equal(await readFile(file, 'utf8'), before)
    await manager.model.update()
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), manager.read())
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('读取结果和修改草稿都不反向改动模型', async () => {
  const { dir, file } = await fixture()
  try {
    const manager = await ProjectManager.open(file)
    manager.read().basic_info.name = '读取副本'
    const draft = manager.read()
    manager.change((project) => { project.basic_info.name = '已修改' })
    draft.basic_info.name = '草稿副本'
    assert.equal(manager.read().basic_info.name, '已修改')
    assert.equal(JSON.parse(await readFile(file, 'utf8')).basic_info.name, '原名称')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('修改函数抛错时保留原数据，且不写文件', async () => {
  const { dir, file } = await fixture()
  try {
    const manager = await ProjectManager.open(file)
    assert.throws(() => manager.change(() => { throw new Error('生成失败') }), /生成失败/)
    assert.equal(manager.read().basic_info.name, '原名称')
    assert.equal(JSON.parse(await readFile(file, 'utf8')).basic_info.name, '原名称')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('缺少文件、损坏 JSON 和非对象会被拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drama-project-'))
  try {
    await assert.rejects(ProjectManager.open(join(dir, 'missing.json')), /项目文件不存在/)
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{')
    await assert.rejects(ProjectManager.open(broken), /需为JSON对象/)
    const list = join(dir, 'list.json')
    await writeFile(list, '[]')
    await assert.rejects(ProjectManager.open(list), /需为普通对象/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('change 只接受函数，拒绝后原数据仍在', async () => {
  const { dir, file } = await fixture()
  try {
    const manager = await ProjectManager.open(file)
    assert.throws(() => manager.change(null), /需为函数/)
    assert.equal(manager.read().basic_info.name, '原名称')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
