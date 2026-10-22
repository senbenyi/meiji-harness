import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TaskGroupModel, TaskModel, StepModel, groupSummary, TaskManager } from '../index.js';
import { createTaskHistory } from '../ui/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const button = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);
function data() {
  const group = new TaskGroupModel({ name: '完整任务组', source: 'session' }).toJSON();
  const tasks = [new TaskModel({ group_id: group.id, node_type: 'custom', name: '生成正文', source: 'panel', task_status: 'completed' }).toJSON(),
    new TaskModel({ group_id: group.id, node_type: 'custom', name: '审核正文', source: 'session', group_seq: 2, queue_order: 2, task_status: 'rejected', end_reason: '资料不完整' }).toJSON()];
  const steps = [new StepModel({ task_id: tasks[0].id, kind: 'generate', name: '生成步骤', executor: 'ai', step_status: 'done', result: '完整结果'.repeat(600),
    prompt: { id: 'prompt', model: 'test', input: {}, created_at: group.created_at, messages: [{ role: 'developer', content: '规则' }, { role: 'user', content: '输入' }] } }).toJSON(),
    new StepModel({ task_id: tasks[1].id, kind: 'review', name: '业务检查', executor: 'program', step_status: 'done', result: { passed: false, reason: '缺少输入', category: '上游资料问题' } }).toJSON()];
  return { ...groupSummary(group, tasks), steps };
}
function mount(t, detail = data(), options = {}) {
  const dom = new JSDOM('<main></main>'), copies = [];
  const calls = { list: 0, detail: 0 }; let listener;
  const source = {
    history: () => { calls.list++; return { tasks: detail.tasks, total: detail.tasks.length, offset: 0, limit: 20 }; },
    detail: () => { calls.detail++; return structuredClone(detail); },
    subscribe: fn => { listener = fn; return () => { listener = null; }; },
  };
  const ui = createTaskHistory({ document: dom.window.document, source, copyText: async text => copies.push(text), ...options });
  dom.window.document.querySelector('main').append(ui.element);
  t.after(() => { ui.dispose(); dom.window.close(); });
  return { ui, root: ui.element.shadowRoot, dom, source, calls, copies, emit: () => listener?.() };
}

test('任务列表展示自身身份状态，整行及键盘入口只打开选中任务；复制不导航', async t => {
  const detail = data(); detail.tasks[0].task_status = 'queued'; detail.tasks[1].task_status = 'running';
  Object.assign(detail, groupSummary(detail.group, detail.tasks));
  const { ui, root, dom, calls, copies } = mount(t, detail); await ui.ready;
  const check = () => {
    const row = root.querySelector('.run-list-row');
    assert.deepEqual([...row.children].map(node => node.tagName), ['DIV', 'DIV', 'P', 'P', 'P']);
    assert.equal(row.children[0].className, 'run-list-heading');
    assert.equal(row.children[1].className, 'meta run-id-row');
    assert.equal(row.children[2].textContent, '类型：custom');
    assert.equal(row.children[3].textContent, `面板发起 · ${detail.tasks[0].created_at}`);
    assert.equal(row.children[4].className, 'error');
    assert.equal(row.tabIndex, 0); assert.equal(row.getAttribute('role'), 'button');
    return row;
  };
  let row = check(); row.querySelector('.run-id-copy').click(); await settle();
  assert.equal(calls.detail, 0); assert.deepEqual(copies, [detail.tasks[0].id]);
  row.querySelector('code').click(); await settle(); assert.equal(calls.detail, 1);
  button(root, '←').click(); await settle();
  row = check(); row.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await settle();
  assert.ok(root.querySelector('.run-task-card'));
  button(root, '←').click(); await settle();
  row = check(); row.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })); await settle();
  assert.ok(root.querySelector('.run-task-card'));
});

test('步骤内联完整结果与复制，展开状态经过记录页面与刷新仍保留；空 HTTP 可进入', async t => {
  const detail = data(), { ui, root, copies } = mount(t, detail); await ui.ready;
  await ui.openGroup(detail.group.id);
  const step = () => root.querySelector('.run-step-card');
  assert.equal(root.querySelectorAll('.run-step-list').length, 1);
  assert.equal(step().tagName, 'LI'); assert.equal(step().dataset.stepNumber, '1');
  assert.equal(step().querySelector('.run-step-executor').textContent, 'AI');
  assert.equal(step().querySelector('.run-step-result pre').textContent, detail.steps[0].result);
  assert.equal(step().classList.contains('is-expanded'), false);
  button(step(), '复制结果').click(); await settle(); assert.equal(copies[0], detail.steps[0].result);
  button(step(), '展开').click(); assert.equal(step().querySelector('.run-step-toggle').getAttribute('aria-expanded'), 'true');
  button(step(), '查看 HTTP').click(); await settle(); assert.match(root.textContent, /此步骤没有已保存的 HTTP 记录/);
  button(root, '←').click(); await settle(); assert.equal(step().classList.contains('is-expanded'), true);
  await ui.refresh(); assert.equal(step().classList.contains('is-expanded'), true);
  button(step(), '查看提示词').click(); await settle();
  assert.equal(root.querySelectorAll('.run-record-actions button').length, 1);
  assert.ok([...root.querySelectorAll('.run-record-card')].every(card => !card.querySelector('button')));
  button(root, '←').click(); await settle(); assert.equal(step().classList.contains('is-expanded'), true);
  button(step(), '收起').click(); assert.equal(step().classList.contains('is-expanded'), false);
});

test('审核诊断由业务回调提供，分类原因/任务创建信息完整展示与复制，不改模型', async t => {
  const detail = data(), before = structuredClone(detail);
  const { ui, root, copies } = mount(t, detail, { presentation: {
    taskName: task => `业务名称：${task.name}`,
    stepName: step => `业务步骤：${step.name}`,
    review: step => ({ rejected: step.result?.passed === false, reason: step.result?.reason, type: step.result?.category }),
  } }); await ui.ready; root.querySelectorAll('.run-list-row')[1].click(); await settle();
  assert.doesNotMatch(root.textContent, /面板发起 · /); assert.match(root.textContent, /会话发起 · /);
  assert.match(root.textContent, /业务名称：审核正文/);
  assert.match(root.textContent, /未通过原因（上游资料问题）：资料不完整/);
  const review = root.querySelector('.run-step-card');
  assert.equal(review.classList.contains('is-failed'), true);
  assert.equal(review.querySelector('.task-history-status').textContent, '未通过');
  button(review, '复制原因').click(); await settle(); assert.equal(copies[0], '未通过原因（上游资料问题）：缺少输入');
  assert.equal(button(review, '查看提示词'), undefined); assert.ok(button(review, '查看 HTTP'));
  assert.equal(button(review, '查看步骤'), undefined);
  assert.equal(review.querySelector('.task-history-status').textContent, '未通过');
  assert.deepEqual(detail, before);
});

test('任务直达入口、失败重试和目标标记；manager 提供通用 resolveTask', async t => {
  const detail = data(); let attempts = 0;
  const { ui, root, source } = mount(t, detail, { initialView: { taskId: detail.tasks[1].id } });
  source.resolveTask = () => { if (++attempts === 1) throw Error('定位失败'); return detail.group.id; };
  // 初始挂载尚未提供解析器，会明确报错；补上数据源后可重试。
  await ui.ready; assert.match(root.textContent, /resolveTask/);
  button(root, '重新加载').click(); await settle(); assert.match(root.textContent, /定位失败/);
  button(root, '重新加载').click(); await settle();
  assert.equal(root.querySelector('.run-task-card').dataset.taskId, detail.tasks[1].id);
  const manager = new TaskManager({ autoStart: false, nodes: { other: { plan: () => [{ kind: 'run' }], execute: async () => ({}) } } });
  t.after(() => manager.dispose());
  const group = manager.submit('scope', { tasks: [{ node_type: 'other' }] });
  assert.equal(manager.historySource('scope').resolveTask(group.tasks[0].id), group.group.id);
  assert.equal(manager.historySource('scope').resolveTask('missing'), null);
});

test('运行详情事件刷新，失败保留旧详情可重试；终态事件复用缓存', async t => {
  const detail = data(); detail.tasks.forEach(task => { task.task_status = 'running'; });
  const { ui, root, source, calls, emit } = mount(t, detail); await ui.ready; await ui.openGroup(detail.group.id);
  const originalDetail = source.detail;
  source.detail = () => { throw Error('刷新失败'); };
  emit(); await settle(); assert.match(root.textContent, /刷新失败/); assert.ok(root.querySelector('.run-step-card'));
  source.detail = originalDetail;
  detail.tasks.forEach(task => { task.task_status = 'completed'; });
  button(root, '重新加载').click(); await settle();
  const after = calls.detail; emit(); await settle(); assert.equal(calls.detail, after);
});

test('缺提示词的显式记录入口显示空页，列表返回保留筛选、页码及缓存', async t => {
  const detail = data(); detail.steps[0].prompt = null;
  const { ui, root, source, dom, calls } = mount(t, detail); await ui.ready;
  source.history = filter => { calls.list++; return { tasks: detail.tasks, total: 45, offset: filter.offset, limit: filter.limit }; };
  await ui.refresh(); button(root, '下一页').click(); await settle();
  await ui.openGroup(detail.group.id);
  await ui.refresh();
  button(root, '←').click(); await settle();
  assert.ok(button(root, '上一页')); const lists = calls.list;
  await ui.openGroup(detail.group.id); button(root, '←').click(); await settle(); assert.equal(calls.list, lists);
  // 明确的消息入口可由外层初始路由传入，空内容不导致渲染异常。
  const empty = createTaskHistory({ document: dom.window.document, source, initialView: { groupId: detail.group.id, stepId: detail.steps[0].id, record: 'prompt' } });
  t.after(() => empty.dispose()); await empty.ready;
  assert.match(empty.element.shadowRoot.textContent, /此步骤没有提示词/);
});

test('输入依赖和任务输出可复制完整JSON，不把内部元数据冒充输出，内容安全且不改记录',async t=>{
  const detail=data();detail.tasks=[detail.tasks[0]];detail.steps=[detail.steps[0]]
  detail.group.metadata={project_id:'project',notify_main:true}
  detail.tasks[0].metadata={request_id:'request',input_dependencies:{script:'<img src=x>\n完整输入',upstream:{id:'node'}}}
  const before=structuredClone(detail),{ui,root,copies}=mount(t,detail);await ui.ready;await ui.openGroup(detail.group.id)
  const deps=root.querySelector('.run-input-dependencies')
  assert.equal(deps.querySelector('summary span').textContent,'输入依赖')
  assert.deepEqual(JSON.parse(deps.querySelector('pre').textContent),detail.tasks[0].metadata.input_dependencies)
  assert.equal(root.querySelector('img'),null)
  assert.equal(root.textContent.includes('业务附加信息'),false)
  assert.equal(button(root,'查看步骤'),undefined)
  assert.equal(root.textContent.includes('任务执行信息'),false)
  const output=root.querySelector('.run-task-output')
  assert.deepEqual(JSON.parse(output.querySelector('pre').textContent),{status:'completed',reason:'',result:null})
  deps.querySelector('button').click();await settle()
  assert.equal(copies[0],deps.querySelector('pre').textContent);assert.equal(deps.open,false)
  output.querySelector('button').click();await settle()
  assert.equal(copies[1],output.querySelector('pre').textContent);assert.equal(output.open,true)
  assert.deepEqual(detail,before)
})

test('多盒子依赖按任务区分，回调只收到本任务步骤，默认可恢复真实prompt输入',async t=>{
  const detail=data();detail.steps[0].prompt.input={original:'原始输入'}
  const scopes=[]
  const {ui,root}=mount(t,detail,{presentation:{inputDependencies:(task,steps)=>{
    scopes.push(steps.every(step=>step.task_id===task.id));return {node:task.node_type,task:task.id}
  }}})
  await ui.ready;await ui.openGroup(detail.group.id)
  const verify=(index)=>{
    const cards=[...root.querySelectorAll('.run-task-card')]
    assert.equal(cards.length,1);assert.ok(scopes.every(Boolean))
    const deps=cards[0].querySelector('.run-input-dependencies')
    assert.equal(JSON.parse(deps.querySelector('pre').textContent).task,detail.tasks[index].id)
    assert.ok(cards[0].querySelector('.run-task-output'))
    assert.equal(deps.nextElementSibling.className,'run-step-list')
    assert.equal(root.querySelector('.page>.run-input-dependencies'),null)
    assert.equal(cards[0].querySelectorAll('.run-step-card').length,1)
    assert.equal(cards[0].querySelector('.run-step-card').dataset.stepId,detail.steps[index].id)
  }
  verify(0)
  button(root,'←').click();await settle();root.querySelectorAll('.run-list-row')[1].click();await settle();verify(1)
  assert.equal(root.querySelector('h2').textContent,detail.tasks[1].name)
  assert.equal(root.textContent.includes(detail.group.id),false)
  assert.equal(root.textContent.includes('任务完成'),false)
  assert.equal(root.textContent.includes(detail.tasks[0].id),false)
  const second=mount(t,detail);await second.ui.ready;await second.ui.openGroup(detail.group.id)
  assert.deepEqual(JSON.parse(second.root.querySelector('.run-input-dependencies pre').textContent),{original:'原始输入'})
  button(second.root,'←').click();await settle();second.root.querySelectorAll('.run-list-row')[1].click();await settle()
  assert.equal(JSON.parse(second.root.querySelector('.run-input-dependencies pre').textContent),null)

})


test('任务输出回调只收到本任务步骤，所有终态保留原因，运行中也能查看状态',async t=>{
  for(const status of ['completed','rejected','failed','cancelled','queued','running']) {
    const detail=data();detail.tasks[0].task_status=status;detail.tasks[0].end_reason='该任务原因'
    const scopes=[],{ui,root}=mount(t,detail,{presentation:{taskOutput:(task,steps)=>{
      scopes.push(steps.every(step=>step.task_id===task.id))
      return {result:task.task_status==='completed'?{body:'<img src=x>\n完整结果'.repeat(200)}:null}
    }}})
    const before=structuredClone(detail);await ui.ready;await ui.openGroup(detail.group.id)
    const output=root.querySelector('.run-task-output'),value=JSON.parse(output.querySelector('pre').textContent)
    assert.equal(value.status,status);assert.equal(value.reason,'该任务原因');assert.ok(scopes.every(Boolean))
    assert.equal(root.querySelector('img'),null);assert.deepEqual(detail,before)
    assert.equal(value.result===null,status!=='completed')
  }
})


test('复制结果通过通知回调反馈，不在页面留下固定提示；失败仍可重试',async t=>{
  const detail=data(),messages=[]
  let fail=false
  const {ui,root}=mount(t,detail,{copyText:async()=>{if(fail)throw Error('拒绝')},onNotify:(message,options)=>messages.push({message,...options})})
  await ui.ready;await ui.openGroup(detail.group.id)
  const copy=root.querySelector('.run-task-output button')
  copy.click();await settle()
  assert.deepEqual(messages.at(-1),{message:'任务输出已复制',kind:'success'})
  assert.equal(root.querySelector('.notice').textContent,'')
  fail=true;copy.click();await settle()
  assert.deepEqual(messages.at(-1),{message:'任务输出复制失败，请重试',kind:'error'})
  assert.equal(root.querySelector('.notice').textContent,'');assert.equal(copy.disabled,false)
})
