import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
