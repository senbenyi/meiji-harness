import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { RulesModel } from '@agent-modules/prompt-composer'
import { nodeDefinitions, renderNodeRules, resolveOutputDefinition, composeNodePrompt, validateNodeOutput } from '../src/index.js'
import { outputInstructions } from '../src/node_runtime/output_contract_renderer.js'
import { createProject } from '../src/node_box/project/create_project.js'

const names = ['script_revision', 'story_segments', 'group_setting', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt', 'costume_image', 'scene_image']
const rules = async name => JSON.parse(await readFile(new URL(`../skills/${name}.json`, import.meta.url), 'utf8'))

test('新项目保存大纲定稿及镜头转译规则，六动作查看和提示词沿用各自快照', async () => {
  const script = '完整工作剧本。总时长：30分钟；每场5分钟。INPUT_BUDGET_300。故事中角色必须在午夜前返回。'
  const project = await createProject({ name: '规则接入', original_script: script })
  for (const nodeType of ['story_segments', 'shot_design']) {
    const source = await rules(nodeType), state = project[nodeType].node_state
    assert.deepEqual(state.rules, source.rules)
    for (const action of ['generate', 'review', 'revise']) {
      state.rules[action].supplement = `本项目${action}补充 {{literal}}`
      const model = new RulesModel({ supports_supplement: state.supports_supplement, rules: state.rules })
      const rendered = renderNodeRules(model, action)
      const input = nodeType === 'story_segments' ? { basic_info: { actual_script: script } }
        : { story_segments: { segments: [{ id: 'segment_001', body: '定稿行动：角色在午夜前归还信件。FINAL_STORY' }] } }
      const prompt = composeNodePrompt({ nodeType, action, rules: model, input })
      const savedBase = state.rules[action].base.replace(/\{\{output:[^{}]*\}\}/gu, '输出字段遵循程序提供的输出契约。')
      assert.ok(prompt.system.includes(savedBase), `${nodeType}/${action}`)
      assert.ok(rendered.base.startsWith(state.rules[action].base.split('输出要求：')[0]), action)
      assert.ok(prompt.system.includes(state.rules[action].supplement), action)
      assert.ok(!prompt.system.includes('INPUT_BUDGET_300'), '输入预算不提升为系统规则')
      if (nodeType === 'story_segments') assert.ok(prompt.user.includes(script), '剧情期限和原稿预算不被程序删掉')
      else {
        assert.ok(prompt.user.includes('FINAL_STORY'), '镜头收到定稿资料')
        assert.ok(!prompt.user.includes('INPUT_BUDGET_300'), '镜头无需原稿时间预算')
      }
    }
    assert.equal(source.rules.generate.supplement, '')
    assert.equal(state.rules.review.supplement, '本项目review补充 {{literal}}')
  }
})

test('27动作只保存规则和引用，使用运行时定义展开，不复制Schema', async () => {
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

test('大纲生成及修订模板与项目结构逐字段逐说明一致，查看规则和实际提示词同源', async () => {
  const document = JSON.parse(await readFile(new URL('../docs/project_detail.json', import.meta.url), 'utf8'))
  const expected = { segments: document.story_segments.segments }
  const model = new RulesModel(await rules('story_segments'))
  const template = outputInstructions(nodeDefinitions.story_segments.output, { format: nodeDefinitions.story_segments.output_format })
  assert.deepEqual(JSON.parse(template.slice(template.indexOf('\n') + 1)), expected)
  assert.doesNotMatch(template, /"properties"|"required"|"node_state"|"output"/)
  assert.match(template, /number必须返回数字/)
  for (const action of ['generate', 'revise']) {
    assert.ok(renderNodeRules(model, action).base.endsWith(template))
    const prompt = composeNodePrompt({ nodeType: 'story_segments', action, rules: model, input: {} })
    assert.ok(prompt.system.endsWith(template))
    assert.equal(prompt.system.split('"segments": [').length, 2, '契约仅注入一次')
  }
  const review = composeNodePrompt({ nodeType: 'story_segments', action: 'review', rules: model, input: {} })
  assert.match(review.system, /JSON Schema/); assert.match(review.system, /"issues"/)
  assert.throws(() => validateNodeOutput('story_segments', 'generate', expected), { code: 'INVALID_NODE_OUTPUT', path: 'output.segments[0].duration_seconds' })
})

test('大纲模板字段来自运行时Schema，新字段展示与校验同步且不读取文档作为运行时模板', async () => {
  const definition = structuredClone(nodeDefinitions), output = definition.story_segments.output
  output.properties.note = { type: 'string', description: '新增说明' }; output.required.push('note')
  const model = new RulesModel(await rules('story_segments'))
  const prompt = composeNodePrompt({ nodeType: 'story_segments', action: 'generate', rules: model, input: {}, definition })
  assert.match(prompt.system, /"note": "string（新增说明）"/)
  assert.match(renderNodeRules(model, 'generate', { definition }).base, /"note": "string（新增说明）"/)
  assert.throws(() => validateNodeOutput('story_segments', 'generate', { segments: [] }, { definition }), { code: 'INVALID_NODE_OUTPUT', path: 'output.note' })
  assert.equal(Object.hasOwn(nodeDefinitions.story_segments.output.properties, 'note'), false)
})
