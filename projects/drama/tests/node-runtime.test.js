import { scriptOutput, nodeRules } from '../src/node_runtime/node_state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, symlink, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { nodeDefinitions, createNode, composeNodePrompt, validateNodeOutput, parseNodeOutput, ProjectManager } from '../src/index.js'

const script = { actual_script: '完整剧本', estimated_duration_seconds: 30, summary: '当前摘要' }
const issue = { location: 'body', reason: '当前事实冲突', suggestion: '按依据修正' }
const names = ['script_revision', 'story_segments', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt', 'costume_image', 'scene_image']

function sample(schema) {
  if (schema.oneOf) return sample(schema.oneOf[0])
  if (Object.hasOwn(schema, 'const')) return schema.const
  if (schema.enum) return schema.enum[0]
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, sample(value)]))
  if (schema.type === 'array') return [sample(schema.items)]
  if (schema.type === 'string') return '有依据的内容'
  if (schema.type === 'number') return 4
  throw Error('未支持的测试样例类型')
}

test('初始化基于运行时字段，共用公共规则和状态，实例相互隔离', async () => {
  const first = await createNode('script_revision'), second = await createNode('script_revision')
  assert.deepEqual({actual_script:first.actual_script,summary:first.summary,estimated_duration_seconds:first.estimated_duration_seconds}, { actual_script: '', estimated_duration_seconds: 0, summary: '' })
  assert.equal(Object.hasOwn(first,'output'),false)
  assert.equal(first.node_state.opinion, '')
  assert.equal(first.node_state.status, 'empty')
  first.actual_script = '局部修改'; first.node_state.rules.generate.supplement = '局部补充'
  assert.equal(second.actual_script, '')
  assert.equal(second.node_state.rules.generate.supplement, '')
  assert.deepEqual((await createNode('character_extraction')).assets, [])
  assert.deepEqual((await createNode('scene_extraction')).scenes, [])
  const image = await createNode('costume_image')
  assert.equal(image.output, undefined); assert.equal(image.address, '')
  await assert.rejects(createNode('video_generation'), { code: 'INVALID_NODE_OUTPUT' })
})

test('同一Model定义新增字段后，初始化、编排和校验一起更新', async () => {
  const definition = structuredClone(nodeDefinitions)
  const node = await createNode('script_revision')
  const before = composeNodePrompt({ nodeType: 'script_revision', action: 'generate', rules: nodeRules(node.node_state), input: { script: '原文' }, definition })
  definition.script_revision.output.properties.revision_note = { type: 'string', description: '本次修改范围' }
  definition.script_revision.output.required.push('revision_note')
  const afterNode = await createNode('script_revision', { definition })
  assert.equal(afterNode.revision_note, '')
  const after = composeNodePrompt({ nodeType: 'script_revision', action: 'generate', rules: nodeRules(node.node_state), input: { script: '原文' }, definition })
  assert.doesNotMatch(before.system, /revision_note/)
  assert.match(after.system, /revision_note/)
  assert.throws(() => validateNodeOutput('script_revision', 'generate', script, { definition }), { code: 'INVALID_NODE_OUTPUT', path: 'output.revision_note' })
  assert.deepEqual(validateNodeOutput('script_revision', 'generate', { ...script, revision_note: '一致' }, { definition }), { ...script, revision_note: '一致' })
})

test('8节点24动作按本次资料编排，契约只注入一次，不重复解释字面量', async () => {
  for (const nodeType of names) {
    const node = await createNode(nodeType)
    for (const action of ['generate', 'review', 'revise']) {
      const result = composeNodePrompt({ nodeType, action, rules: nodeRules(node.node_state), goal: '当前目标', input: { content: '{{literal}}' } })
      assert.equal(result.messages.length, 2)
      assert.ok(result.system.includes(nodeType))
      assert.ok(!result.system.includes('{{output:'))
      assert.match(result.user, /\{\{literal\}\}/)
      assert.equal(result.system.split('# 输出契约\n').length, 2)
      if (nodeType === 'script_revision' && action !== 'review') assert.equal(result.system.split('"estimated_duration_seconds": {').length, 2)
    }
  }
})

test('补充规则不改变结构契约，跨节点/跨动作引用明确拒绝', async () => {
  const node = await createNode('script_revision')
  node.node_state.rules.generate.supplement = '保留 {{literal}}'
  const result = composeNodePrompt({ nodeType: 'script_revision', action: 'generate', rules: nodeRules(node.node_state), input: {} })
  assert.match(result.system, /保留 \{\{literal\}\}/)
  assert.match(result.system, /业务规则不能改写输出结构/)
  node.node_state.rules.generate.supplement = '{{output:#/$defs/review_output}}'
  assert.throws(() => composeNodePrompt({ nodeType: 'script_revision', action: 'generate', rules: nodeRules(node.node_state), input: {} }), /输出契约不一致/)
})

test('解析校验拒绝缺失、额外、错误类型、非有限数字及非法JSON', () => {
  const parsed = parseNodeOutput('script_revision', 'generate', JSON.stringify(script))
  assert.deepEqual(parsed, script); parsed.actual_script = '副本'; assert.equal(script.actual_script, '完整剧本')
  for (const value of [{ actual_script: '不完整' }, { ...script, extra: '' }, { ...script, estimated_duration_seconds: '30' }, { ...script, estimated_duration_seconds: 0 }, { ...script, estimated_duration_seconds: Infinity }, { ...script, actual_script: '' }]) {
    assert.throws(() => validateNodeOutput('script_revision', 'revise', value), { code: 'INVALID_NODE_OUTPUT' })
  }
  assert.throws(() => parseNodeOutput('script_revision', 'generate', '```json\n{}\n```'), { code: 'INVALID_NODE_OUTPUT' })
  assert.throws(() => validateNodeOutput('costume_image', 'generate', { address: '虚构' }), { code: 'INVALID_NODE_OUTPUT' })
})

test('模型JSON字符串内的原始换行回车制表符无损归一化，已有转义和引号不变', () => {
  const value = { ...script, actual_script: '第一行\n第二行\r\n\t第三行："对白"，路径C:\\稿件，字面\\n' }
  const raw = JSON.stringify(value).replace('第一行\\n第二行\\r\\n\\t', '第一行\n第二行\r\n\t')
  assert.throws(() => JSON.parse(raw))
  assert.deepEqual(parseNodeOutput('script_revision', 'generate', raw), value)
  assert.deepEqual(parseNodeOutput('script_revision', 'revise', raw), value)
  assert.equal(raw.includes('第一行\n第二行'), true, '不改写原始响应')
})

test('编码归一化不猜测结构，不接受截断、错误转义、控制符或不符合Schema的结果', () => {
  for (const raw of [
    '{"actual_script":"第一行\n第二行"',
    '{"actual_script":"第一行\n第二行",}',
    '{"actual_script":"第一行\n\\q"}',
    '{"actual_script":"第一行\u0000第二行"}',
    '{"actual_script":"第一行\\' + '\n' + '第二行"}',
    '{"actual_script":"第一行\n第二行"}',
    JSON.stringify({ ...script, extra: '第一行\n第二行' }).replace('第一行\\n第二行', '第一行\n第二行'),
  ]) assert.throws(() => parseNodeOutput('script_revision', 'generate', raw), { code: 'INVALID_NODE_OUTPUT' })
})

test('文本节点可校验完整返回，镜头枚举及节拍容量有约束', () => {
  for (const nodeType of names.filter(name => nodeDefinitions[name].kind === 'text')) {
    const value = sample(nodeDefinitions[nodeType].output)
    assert.deepEqual(validateNodeOutput(nodeType, 'generate', value), value)
  }
  const shot = sample(nodeDefinitions.shot_design.output)
  shot.shots[0].previous_shot_connection = 'unknown'
  assert.throws(() => validateNodeOutput('shot_design', 'generate', shot), { code: 'INVALID_NODE_OUTPUT' })
  shot.shots[0].previous_shot_connection = 'opening'; shot.shots[0].beats = []
  assert.throws(() => validateNodeOutput('shot_design', 'generate', shot), { code: 'INVALID_NODE_OUTPUT' })
})

test('视频提示词三模式结构互斥且不接收视频接口参数', () => {
  const choices = nodeDefinitions.video_prompt.output.properties.items.items.oneOf
  for (const choice of choices) assert.doesNotThrow(() => validateNodeOutput('video_prompt', 'generate', { items: [sample(choice)] }))
  const first = sample(choices[0]), second = sample(choices[1])
  assert.throws(() => validateNodeOutput('video_prompt', 'generate', { items: [{ ...first, multimodal: second.multimodal }] }), { code: 'INVALID_NODE_OUTPUT' })
  first.text_to_video.duration = 8
  assert.throws(() => validateNodeOutput('video_prompt', 'generate', { items: [first] }), { code: 'INVALID_NODE_OUTPUT' })
})

test('审核统一结构要求结论和问题一致，审核不会覆盖业务output', () => {
  assert.deepEqual(validateNodeOutput('scene_image', 'review', { status: 'passed', issues: [] }), { status: 'passed', issues: [] })
  assert.doesNotThrow(() => validateNodeOutput('script_revision', 'review', { status: 'upstream_issue', issues: [issue] }))
  for (const value of [{ status: 'passed', issues: [issue] }, { status: 'content_issue', issues: [] }, { status: 'other', issues: [] }]) {
    assert.throws(() => validateNodeOutput('script_revision', 'review', value), { code: 'INVALID_NODE_OUTPUT' })
  }
})

test('无docs目录仍能初始化、组装和校验', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drama-runtime-only-'))
  try {
    await cp(new URL('../src/', import.meta.url), join(dir, 'src'), { recursive: true })
    await cp(new URL('../skills/', import.meta.url), join(dir, 'skills'), { recursive: true })
    await symlink(resolve(new URL('../../../node_modules', import.meta.url).pathname), join(dir, 'node_modules'), 'dir')
    const code = `import {createNode,composeNodePrompt,parseNodeOutput} from './src/index.js'; const n=await createNode('script_revision'); composeNodePrompt({nodeType:'script_revision',action:'generate',rules:{supports_supplement:n.node_state.supports_supplement,rules:n.node_state.rules},input:{}}); parseNodeOutput('script_revision','generate',${JSON.stringify(JSON.stringify(script))}); console.log('ok');`
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8' }).trim(), 'ok')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('校验后写入项目，保留人工输入，未校验结果不自动落库', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drama-node-save-'))
  try {
    const file = join(dir, 'project.json'), node = await createNode('script_revision')
    node.node_state.opinion = '人工意见'; await writeFile(file, JSON.stringify({ basic_info: { actual_script: '', summary: '', estimated_duration_seconds: 0, script_revision_node: node.node_state } }))
    const manager = await ProjectManager.open(file)
    const output = parseNodeOutput('script_revision', 'revise', script)
    manager.change(draft => { Object.assign(draft.basic_info, output) })
    await manager.model.update()
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.basic_info.script_revision_node.opinion, '人工意见')
    assert.deepEqual(scriptOutput(saved), script)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
