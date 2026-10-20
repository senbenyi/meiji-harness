import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { RulesModel } from '@agent-modules/prompt-composer'
import { nodeDefinitions, renderNodeRules, resolveOutputDefinition } from '../src/index.js'

const names = ['script_revision', 'story_segments', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt', 'costume_image', 'scene_image']
const rules = async name => JSON.parse(await readFile(new URL(`../skills/${name}.json`, import.meta.url), 'utf8'))

test('24动作只保存规则和引用，使用运行时定义展开，不复制Schema', async () => {
  for (const name of names) {
    const input = await rules(name), model = new RulesModel(input)
    for (const action of ['generate', 'review', 'revise']) {
      assert.deepEqual(Object.keys(input.rules[action]).sort(), ['base', 'supplement'])
      assert.match(input.rules[action].base, /字段处理方法：/)
      const rendered = renderNodeRules(model, action)
      assert.ok(!rendered.base.includes('{{output:'))
      if (action === 'review') assert.match(rendered.base, /"status"[\s\S]*"issues"/)
      else if (['costume_image', 'scene_image'].includes(name)) assert.match(rendered.base, /真实媒体结果/)
      assert.deepEqual(model.toJSON(), input)
    }
  }
})

test('本地引用展开与Pointer转义，结果独立于定义', () => {
  const result = resolveOutputDefinition('#/video_prompt/output')
  assert.equal(result.properties.items.items.oneOf.length, 3)
  result.properties.items.items.oneOf.length = 0
  assert.equal(nodeDefinitions.video_prompt.output.properties.items.items.oneOf.length, 3)
  assert.equal(resolveOutputDefinition('#/a~1b/~0key', { 'a/b': { '~key': '值' } }), '值')
})

test('缺失、外部、非法转义、循环和未完整引用明确失败', () => {
  for (const reference of ['https://example.com/schema', 'other.json#/node', '#/missing', '#/__proto__', '#/bad~2key']) {
    assert.throws(() => resolveOutputDefinition(reference), { code: 'INVALID_OUTPUT_DEFINITION' })
  }
  const cyclic = { a: { $ref: '#/b' }, b: { $ref: '#/a' } }
  assert.throws(() => resolveOutputDefinition('#/a', cyclic), { code: 'INVALID_OUTPUT_DEFINITION' })
  assert.throws(() => resolveOutputDefinition('#/a', { a: { $ref: '#/b', extra: true }, b: {} }), { code: 'INVALID_OUTPUT_DEFINITION' })
  const model = new RulesModel({ rules: { generate: { base: '{{output:#/broken}' } } })
  assert.throws(() => renderNodeRules(model, 'generate'), { code: 'INVALID_OUTPUT_DEFINITION' })
})

test('关闭补充能力不展开其引用，字面占位符与已保存业务文本保留', () => {
  const input = { supports_supplement: false, rules: { generate: { base: '项目规则 {{literal}}', supplement: '{{output:#/missing}}' } } }
  assert.deepEqual(renderNodeRules(input, 'generate'), { base: '项目规则 {{literal}}', supplement: '' })
  input.supports_supplement = true
  assert.throws(() => renderNodeRules(input, 'generate'), { code: 'INVALID_OUTPUT_DEFINITION' })
})
