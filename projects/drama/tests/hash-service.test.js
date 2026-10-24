import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { HashService } from '../src/project_runtime/hash-service.js'

test('独立HashService比较内容时忽略对象字段顺序，保留数组顺序和内容差异', () => {
  const service = new HashService()
  const output = { actual_script: '正文', estimated_duration_seconds: 90, summary: '摘要', nested: [{ a: 1, b: 2 }] }
  const reordered = { summary: '摘要', nested: [{ b: 2, a: 1 }], actual_script: '正文', estimated_duration_seconds: 90 }
  assert.equal(service.matches(output, reordered), true)
  assert.equal(service.matches(output, { ...reordered, summary: '新摘要' }), false)
  assert.equal(service.matches([1, 2], [2, 1]), false)
})

test('HashService未接入生产执行链，盒子源码不计算或消费内容指纹', async () => {
  const root = new URL('../src/', import.meta.url)
  const entries = await readdir(root, { recursive: true })
  for (const file of entries.filter(file => file.endsWith('.js'))) {
    const source = await readFile(new URL(file, root), 'utf8')
    if (file !== 'project_runtime/hash-service.js') assert.doesNotMatch(source, /(?:from\s+|import\s*\().*hash-service|new\s+HashService\b/, file)
    if (file.startsWith('node_box/')) assert.doesNotMatch(source, /\b(?:createHash|digest|\w*Fingerprint|input_hash|output_hash)\b/, file)
  }
})
