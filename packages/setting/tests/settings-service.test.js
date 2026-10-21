import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsService } from '../src/service.js'

const spec = { language: { field: 'language', default: 'zh', options: [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }] }, models: {
  writer: { default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
} }
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'settings-service-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'settings.json')
}

test('公共服务支持任意用途和语言字段，保存前校验，不接受未声明字段', async t => {
  const file = await fixture(t); let calls = 0
  const service = createSettingsService({ file, spec, defaults: { endpoint: 'local' }, beforeSave: ({ next }) => { calls++; next.writer.model = '不影响实际保存' } })
  assert.equal((await service.read()).writer.model, 'a')
  await service.save({ writer: { model: 'b' }, language: 'en' })
  assert.equal((await service.read()).writer.model, 'b')
  assert.equal((await service.read()).endpoint, 'local')
  const before = await readFile(file, 'utf8')
  await assert.rejects(service.save({ writer: { model: 'invalid' } }), /请选择有效模型/)
  await assert.rejects(service.save({ endpoint: 'changed' }), /未知设置字段/)
  await assert.rejects(service.save(null), /需为对象/)
  assert.equal(calls, 1); assert.equal(await readFile(file, 'utf8'), before)
  const extras = createSettingsService({ file, spec, allowedFields: ['endpoint'] })
  await extras.save({ endpoint: 'remote' }); assert.equal((await extras.read()).endpoint, 'remote')
})

test('同文件多个服务的回调串行读取最新快照，失败不落盘也不阻断后续保存', async t => {
  const file = await fixture(t), seen = []
  let release, started
  const entered = new Promise(resolve => { started = resolve }), gate = new Promise(resolve => { release = resolve })
  const first = createSettingsService({ file, spec, beforeSave: async ({ next }) => { seen.push(next.language); started(); await gate } })
  const second = createSettingsService({ file, spec, beforeSave: ({ current, next }) => { seen.push([current.language, next.writer.model]) } })
  const a = first.save({ language: 'en' }); await entered
  const b = second.save({ writer: { model: 'b' } }); release(); await Promise.all([a, b])
  assert.deepEqual(seen, ['en', ['en', 'b']])
  const before = await readFile(file, 'utf8')
  const failed = createSettingsService({ file, spec, beforeSave: () => { throw new Error('宿主拒绝') } })
  await assert.rejects(failed.save({ language: 'zh' }), /宿主拒绝/)
  assert.equal(await readFile(file, 'utf8'), before)
  await second.save({ language: 'zh' }); assert.equal((await second.read()).language, 'zh')
})
