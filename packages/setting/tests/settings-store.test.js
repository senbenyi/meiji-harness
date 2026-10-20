import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsStore } from '../src/store.js'

const spec = {
  language: { field: 'output_language', default: 'zh-CN', options: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }] },
  models: {
    session: { options: [{ value: 'local', label: '本地' }, { value: 'remote', label: '远程' }], default: 'remote' },
    draft: { options: [{ value: 'local', label: '本地' }, { value: 'remote', label: '远程' }] },
  },
}

test('缺文件使用默认值，写入保留额外字段并原子替换', async () => {
  const root = await mkdtemp(join(tmpdir(), 'setting-store-'))
  const file = join(root, 'nested', 'settings.json')
  try {
    const defaults = () => ({ endpoint: 'http://127.0.0.1:9', draft: { model: 'local' }, token: 'secret' })
    const store = createSettingsStore(file, { spec, defaults })
    const read = await store.read()
    assert.equal(read.session.model, 'remote')
    assert.equal(read.endpoint, 'http://127.0.0.1:9')
    await assert.rejects(stat(file), { code: 'ENOENT' })
    const saved = await store.write({ output_language: 'en', draft: { model: 'remote' } })
    assert.equal(saved.token, 'secret')
    assert.equal(saved.output_language, 'en')
    const text = await readFile(file, 'utf8')
    assert.equal(text, `${JSON.stringify(saved, null, 2)}\n`)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    await assert.rejects(stat(`${file}.tmp`), { code: 'ENOENT' })
    assert.equal((await store.read()).draft.model, 'remote')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('无效选择不改已有文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'setting-store-'))
  const file = join(root, 'settings.json')
  try {
    const store = createSettingsStore(file, { spec, defaults: { draft: { model: 'local' } } })
    await store.write({ draft: { model: 'local' } })
    const before = await readFile(file, 'utf8')
    await assert.rejects(store.write({ draft: { model: 'missing' } }), { code: 'INVALID_SETTINGS', path: 'draft' })
    assert.equal(await readFile(file, 'utf8'), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('同文件不同store的并发补丁串行合并，失败后队列仍可写', async () => {
  const root = await mkdtemp(join(tmpdir(), 'setting-concurrency-'))
  const file = join(root, 'settings.json')
  try {
    const options = { spec, defaults: { draft: { model: 'local' } } }
    const stores = [createSettingsStore(file, options), createSettingsStore(join(root, '.', 'settings.json'), options)]
    await stores[0].write({})
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => stores[i % 2].write({ [`field_${i}`]: i })))
    assert.ok(results.every(result => result.status === 'fulfilled'), JSON.stringify(results))
    const saved = await stores[0].read()
    for (let i = 0; i < 12; i++) assert.equal(saved[`field_${i}`], i)
    const recovery = await Promise.allSettled([
      stores[0].write({ draft: { model: 'missing' } }),
      stores[1].write({ output_language: 'en' }),
    ])
    assert.equal(recovery[0].status, 'rejected')
    assert.equal(recovery[0].reason.code, 'INVALID_SETTINGS')
    assert.equal(recovery[1].status, 'fulfilled')
    const next = await stores[0].read()
    assert.equal(next.output_language, 'en')
    assert.equal(next.field_11, 11)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.deepEqual(await readdir(root), ['settings.json'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
