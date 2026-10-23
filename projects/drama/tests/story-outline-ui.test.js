import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createProject } from '../src/node_box/project/create_project.js'
import { createProjectView } from '../src/client/project-overview.js'
import { createTaskOperation, groupTaskMessages } from '../src/client/ui/task-operation.js'

const segment = { id: 's1', title: '交还信件', body: '<img src=x>完整递信过程', world_background: '当代', key_anchors: [{ id: 'k1', content: '交还信件', expression: '动作' }],
  characters_and_groups: '林舟、陈叔', scene_and_space: '旧车站', emotion_and_rhythm: '平静', duration_seconds: 30, continuity: { opening: '持信', ending: '收信' } }
async function setup(t, options = {}) {
  const dom = new JSDOM('<main/>'), old = globalThis.document; globalThis.document = dom.window.document
  const project = await createProject({ name: '大纲UI测试', original_script: '当前完整剧本' })
  const state = {}, root = document.querySelector('main'), view = createProjectView(root, { project, state, ...options })
  t.after(() => { view.dispose(); globalThis.document = old; dom.window.close() })
  root.querySelector('.project-next').click()
  return { dom, root, project, view, state }
}
const button = (root, label) => [...root.querySelectorAll('button')].find(node => node.textContent === label)

test('面板生成提交当前意见，连点守卫、稳定请求ID重试、执行步骤及完成状态', async t => {
  let fail = true, calls = [], entered, release
  const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => entered = resolve)
  const f = await setup(t, { generateStory: async (instruction, id) => { calls.push({ instruction, id }); if (fail) throw new Error('暂时失败'); entered(); await gate; return { group_id: 'g', status: 'queued' } } })
  t.after(() => release())
  const { root, dom, project, view } = f
  const input = root.querySelector('input'); input.value = '保留完整递信过程'; input.dispatchEvent(new dom.window.Event('input'))
  await button(root, 'AI生成').onclick()
  assert.match(root.querySelector('.node-ui-failure').textContent, /暂时失败/)
  fail = false; const pending = button(root, 'AI生成').onclick(); await start
  assert.equal(button(root, 'AI生成').disabled, true); await button(root, 'AI生成').onclick()
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1])
  assert.equal(root.querySelector('.node-ui-step').textContent, '正在提交大纲任务…')
  release(); await pending
  assert.equal(root.querySelector('.node-ui-step').textContent, '排队中，等待执行…')
  view.update(project, { storyExecution: { group_id: 'g', status: 'running', node_state_before: project.story_segments.node_state, step: { kind: 'review' } } })
  assert.equal(root.querySelector('.node-ui-step').textContent, '正在审核故事大纲，等待模型返回…')
  view.update(project, { storyExecution: { group_id: 'g', status: 'running', step: { kind: 'revise' }, review_issues: [{ location: 'body', reason: '遗漏动作', suggestion: '补全' }] } })
  assert.match(root.querySelector('.node-ui-step.is-rejected').textContent, /修订.*\n未通过原因：body：遗漏动作/)
  const done = structuredClone(project); done.story_segments.segments = [segment]; done.story_segments.node_state.status = 'generated'
  view.update(done, { storyExecution: null })
  assert.equal(button(root, '按意见修改').disabled, false); assert.equal(root.querySelector('.node-data-tag').textContent, '已生成')
  assert.match(root.querySelector('.production-card').textContent, /完整递信过程/); assert.equal(root.querySelector('img'), null)
  assert.equal(root.querySelector('.node-ui-step'), null)
  assert.equal(button(root, '复制大纲').disabled, false)
})

test('没有工作稿不能生成；成功消费旧意见仅清同值草稿，失败及新草稿保留', async t => {
  const f = await setup(t, { generateStory: async () => ({}) }), { root, project, view, state } = f
  assert.equal(button(root, 'AI生成').disabled, false)
  assert.equal(project.basic_info.script_revision_node.status, 'empty')
  const blank = structuredClone(project); blank.basic_info.actual_script = ' \n\t'
  view.update(blank); assert.equal(button(root, 'AI生成').disabled, true)
  project.story_segments.node_state.opinion = '旧意见'; state.nodeOpinions.story_segments = '旧意见'; view.update(project)
  const done = structuredClone(project); done.story_segments.node_state.opinion = ''; done.story_segments.node_state.status = 'generated'; done.story_segments.segments = [segment]
  view.update(done); assert.equal(root.querySelector('input').value, '')
  view.update(project); state.nodeOpinions.story_segments = '新草稿'; view.update(done)
  assert.equal(root.querySelector('input').value, '新草稿')
})

test('运行通知先于受理回包时不退回排队；不同任务及终态清理旧步骤', async t => {
  let entered, release
  const start = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve)
  const { root, project, view } = await setup(t, { generateStory: async () => { entered(); await gate; return { group_id: 'g', status: 'queued' } } })
  t.after(() => release())
  const pending = button(root, 'AI生成').onclick(); await start
  view.update(project, { storyExecution: { group_id: 'g', status: 'running', step: { kind: 'generate' } } })
  assert.equal(root.querySelector('.node-ui-step').textContent, '正在生成故事大纲，等待模型返回…')
  release(); await pending
  assert.equal(root.querySelector('.node-ui-step').textContent, '正在生成故事大纲，等待模型返回…')
  view.update(project, { storyExecution: { group_id: 'other', status: 'queued' } })
  assert.equal(root.querySelector('.node-ui-step').textContent, '排队中，等待执行…')
  view.update(project, { storyExecution: { group_id: 'other', status: 'running' } })
  assert.equal(root.querySelector('.node-ui-step').textContent, '正在执行故事大纲任务…')
  view.update(project, { storyExecution: { group_id: 'other', status: 'completed' } })
  assert.equal(root.querySelector('.node-ui-step'), null)
  assert.equal(button(root, 'AI生成').disabled, false)
})

test('会话展示当次工作稿、输入大纲、步骤结果和最终大纲，查看结果不读当前项目', async t => {
  const dom = new JSDOM('<main/>'), document = dom.window.document
  const input = { basic_info: { actual_script: '当次工作剧本' }, current_outline: { segments: [] }, instruction: '保留完整过程', output_language: 'zh-CN' }
  const output = { segments: [segment] }
  const messages = [
    { id: 'start', group_id: 'g', phase: 'start', node_type: 'story_segments', operation_name: '故事大纲', operation_status: 'completed', box_input: input },
    { id: 'step', group_id: 'g', phase: 'step', node_type: 'story_segments', seq: 1, step_name: '生成故事大纲', status: 'done', operation_status: 'completed', input, result: { output } },
    { id: 'end', group_id: 'g', phase: 'result', node_type: 'story_segments', status: 'completed', operation_status: 'completed', saved: true, box_input: input, final_output: output },
  ]
  let copied = ''
  const ui = createTaskOperation(document, { getMessage: id => messages.find(row => row.id === id), copy: async text => { copied = text }, onNotify: () => {} })
  document.querySelector('main').append(ui.element); ui.update(groupTaskMessages(messages)[0])
  t.after(() => { ui.dispose(); dom.window.close() })
  const root = ui.element.shadowRoot, details = root.querySelector('[data-expand="box-input"]')
  details.open = true; await details.ontoggle()
  assert.match(details.textContent, /当次工作剧本/); assert.match(details.textContent, /保留完整过程/)
  await button(details, '复制盒子输入').onclick(); assert.deepEqual(JSON.parse(copied), input)
  assert.match(root.querySelector('.outcome').textContent, /大纲完成，已保存/)
  assert.match(root.querySelector('.outcome').textContent, /审核通过，故事大纲已更新/)
  await button(root, '查看本次大纲').onclick()
  assert.match(root.querySelector('dialog').textContent, /完整递信过程/)
  assert.equal(root.querySelector('img'), null)
})
