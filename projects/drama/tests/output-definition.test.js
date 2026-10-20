import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RulesModel } from '../../../packages/prompt-composer/src/index.js'
import { renderNodeRules, resolveOutputDefinition, ProjectManager } from '../src/index.js'

const documentFile = new URL('../docs/project_detail.json', import.meta.url)
const readDefinition = async () => JSON.parse(await readFile(documentFile, 'utf8'))
const rules = async name => JSON.parse(await readFile(new URL(`../skills/${name}.json`, import.meta.url), 'utf8'))
const textNodes = ['script_revision', 'story_segments', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt']
const imageNodes = ['costume_image', 'scene_image']
const modelFor = (pointer, supplement = '') => new RulesModel({ supports_supplement: true, rules: {
  generate: { base: `保留项目规则\n{{output:${pointer}}}`, supplement },
} })

test('AI内容与人工/程序字段分开，图片资产明确关联，程序节点不增output', async () => {
  const doc = await readDefinition()
  for (const name of textNodes) {
    assert.ok(doc[name].output)
    assert.ok(doc[name].rules)
    assert.ok(doc[name].node_state)
  }
  assert.deepEqual(Object.keys(doc.script_revision.output), ['body', 'estimated_duration_seconds', 'summary'])
  assert.match(doc.script_revision.output.estimated_duration_seconds, /^number（/)
  assert.ok(doc.script_revision.opinion)
  assert.equal(doc.script_revision.body, undefined)
  assert.equal(doc.story_segments.segments, undefined)
  for (const character of doc.character_extraction.output.characters) {
    assert.equal(character.reference_image, undefined)
    assert.equal(character.costume_images, undefined)
    assert.ok(doc.character_extraction.assets.some(asset => `string（${asset.character_id}）` === character.id))
  }
  for (const scene of doc.scene_extraction.output.scenes) assert.equal(scene.image_generation, undefined)
  assert.ok(doc.scene_extraction.assets[0].image_generation.address)
  assert.ok(doc.character_extraction.assets[0].costume_images[0].address)
  for (const item of doc.video_prompt.output.items) {
    const mode = Object.keys(item).find(key => key !== 'clip_id')
    assert.deepEqual(Object.keys(item[mode]), ['prompt'])
  }
  assert.equal(doc.video_prompt.bindings, undefined)
  for (const node of [doc.clip_arrangement, doc.videos[0].video_generation, doc.episodes[0]]) assert.equal(node.output, undefined)
})

test('24个动作仅保存规则与引用，可直接使用RulesModel，全部可展开', async () => {
  const definition = await readDefinition()
  for (const name of [...textNodes, ...imageNodes]) {
    const input = await rules(name)
    assert.deepEqual(Object.keys(input).sort(), ['rules', 'supports_supplement'])
    const model = new RulesModel(input)
    for (const action of ['generate', 'review', 'revise']) {
      const data = input.rules[action]
      assert.deepEqual(Object.keys(data).sort(), ['base', 'supplement'])
      const pointer = action === 'review' ? '#/$defs/review_output'
        : imageNodes.includes(name) ? '#/$defs/image_output' : `#/${name}/output`
      assert.ok(data.base.endsWith(`{{output:${pointer}}}`))
      assert.doesNotMatch(data.base, /\n\{(?!\{)/u)
      const rendered = await renderNodeRules(model, action, { definition })
      assert.ok(!rendered.base.includes('{{output:'))
      if (action === 'review') assert.match(rendered.base, /"status"[\s\S]*"issues"/)
      else if (imageNodes.includes(name)) assert.match(rendered.base, /真实媒体结果/)
      assert.deepEqual(model.toJSON(), input)
    }
  }
})

test('新字段和字段解释来自最新文件，无需改规则或重建Model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drama-output-definition-'))
  try {
    const file = join(dir, 'definition.json'), definition = await readDefinition()
    const model = new RulesModel(await rules('script_revision'))
    const original = model.toJSON()
    await writeFile(file, JSON.stringify(definition))
    const before = await renderNodeRules(model, 'generate', { definitionFile: file })
    definition.script_revision.output.additional_content = 'string（本次新增字段的说明。）'
    definition.script_revision.output.summary = 'string（更新后的摘要含义。）'
    await writeFile(file, JSON.stringify(definition))
    const after = await renderNodeRules(model, 'generate', { definitionFile: file })
    assert.doesNotMatch(before.base, /additional_content|更新后的摘要含义/)
    assert.match(after.base, /additional_content/)
    assert.match(after.base, /更新后的摘要含义/)
    assert.deepEqual(model.toJSON(), original)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('输出本地引用递归展开、支持Pointer转义，读取结果与定义隔离', async () => {
  const doc = await readDefinition()
  const output = resolveOutputDefinition('#/video_prompt/output', doc)
  assert.equal(JSON.stringify(output).includes('$ref'), false)
  const modes = output.items.map(item => Object.keys(item).find(key => key !== 'clip_id'))
  assert.deepEqual(modes, ['text_to_video', 'multimodal', 'first_last_frame'])
  assert.equal(Object.keys(output.items[0].text_to_video.prompt).length, 3)
  assert.equal(Object.keys(output.items[1].multimodal.prompt).length, 6)
  assert.equal(Object.keys(output.items[2].first_last_frame.prompt).length, 4)
  output.items[0].clip_id = '修改副本'
  assert.notEqual(doc.video_prompt.output.items[0].clip_id, '修改副本')
  assert.equal(resolveOutputDefinition('#/a~1b/~0key', { 'a/b': { '~key': 'string（值）' } }), 'string（值）')
})

test('缺失、非法、外部、循环和未完整引用明确失败', async () => {
  for (const pointer of ['https://example.com/schema', 'other.json#/node', '#/missing', '#/__proto__', '#/bad~2key']) {
    assert.throws(() => resolveOutputDefinition(pointer, {}), { code: 'INVALID_OUTPUT_DEFINITION' })
  }
  const cyclic = { a: { $ref: '#/b' }, b: { $ref: '#/a' } }
  assert.throws(() => resolveOutputDefinition('#/a', cyclic), { code: 'INVALID_OUTPUT_DEFINITION' })
  assert.throws(() => resolveOutputDefinition('#/a', { a: { $ref: '#/b', extra: true }, b: {} }), { code: 'INVALID_OUTPUT_DEFINITION' })
  const invalidModel = new RulesModel({ supports_supplement: true, rules: { generate: { base: '{{output:#/broken}' } } })
  await assert.rejects(renderNodeRules(invalidModel, 'generate'), { code: 'INVALID_OUTPUT_DEFINITION' })
  await assert.rejects(renderNodeRules(modelFor('#/missing'), 'generate'), { code: 'INVALID_OUTPUT_DEFINITION' })
  await assert.rejects(renderNodeRules(modelFor('#/a'), 'generate', { definition: cyclic }), { code: 'INVALID_OUTPUT_DEFINITION' })
  await assert.rejects(renderNodeRules(modelFor('#/a'), 'unknown'), { code: 'INVALID_OUTPUT_DEFINITION' })
})

test('补充规则只在启用时展开，普通字面量和项目业务文本保持原样', async () => {
  const doc = await readDefinition()
  const input = { supports_supplement: false, rules: { generate: { base: '项目自定规则 {{literal}}', supplement: '{{output:#/missing}}' } } }
  assert.deepEqual(await renderNodeRules(input, 'generate', { definition: doc }), { base: '项目自定规则 {{literal}}', supplement: '' })
  input.supports_supplement = true
  await assert.rejects(renderNodeRules(input, 'generate', { definition: doc }), { code: 'INVALID_OUTPUT_DEFINITION' })
  input.rules.generate.supplement = '{{output:#/$defs/review_output}}'
  const rendered = await renderNodeRules(input, 'generate', { definition: doc })
  assert.match(rendered.supplement, /"issues"/)
  assert.equal(rendered.base, input.rules.generate.base)
})

test('新布局可持久化，更新AI内容时外层人工输入和资产记录独立保留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drama-output-project-'))
  try {
    const file = join(dir, 'project.json')
    const project = {
      script_revision: { opinion: '人工意见', output: { body: '初稿', estimated_duration_seconds: 30, summary: '摘要' } },
      character_extraction: { output: { characters: [{ id: 'c1', name: '甲' }] }, assets: [{ character_id: 'c1', reference_image: 'data:image/png;base64,real' }] },
    }
    await writeFile(file, JSON.stringify(project))
    const manager = await ProjectManager.open(file)
    manager.change(draft => { draft.script_revision.output = { body: '修订稿', estimated_duration_seconds: 40, summary: '新摘要' } })
    await manager.model.update()
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.script_revision.output.body, '修订稿')
    assert.equal(saved.script_revision.opinion, '人工意见')
    assert.deepEqual(saved.character_extraction.assets, project.character_extraction.assets)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
