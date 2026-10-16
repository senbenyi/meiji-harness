import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createAiRoutes, composeNodePrompt, nodeRoutes } from '../server/http/ai-routes.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { createTaskHttpHandler } from '../server/http/task-routes.js';
import { modelStore } from '../server/data/model-settings.js';
import { emptyProject } from '../shared/project_contract.js';
import { elysiumClient } from '../server/http/elysium/client.js';
import { llmServerClient } from '../server/http/llm-server/client.js';
import { withGatewayTrace } from '../server/gateway/gateway-trace.js';
import { config, sampleInput, renderTaskPrompt } from './fixtures/ai.js';
import { snapshotFixture, taskFixture } from './fixtures/project.js';

const input = { script: '阿明寻找钥匙，最终在门口找到。', language: 'zh-CN', requirements: '用一句话概括。' };
const completion = content => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };

test('所有文本节点修订使用四条消息，意见只在最后，system 不再附角色', () => {
  for (const [node, route] of Object.entries(nodeRoutes)) {
    const contract = route.actions.regenerate;
    if (!contract || !['文本', 'JSON'].includes(contract.output.type)) continue;
    const input = { ...sampleInput(contract.input), opinion: '本轮意见唯一标记' };
    const prompt = composeNodePrompt(node, 'regenerate', input, 'qwen3.5:27b');
    assert.deepEqual(prompt.messages.map(message => message.role), ['system', 'user', 'assistant', 'user'], node);
    assert.equal(prompt.messages[2].content, typeof input.content === 'string' ? input.content : JSON.stringify(input.content, null, 2));
    assert.equal(prompt.messages.slice(0, 3).some(message => message.content.includes(input.opinion)), false);
    assert.match(prompt.messages[3].content, /本轮意见唯一标记/);
    assert.doesNotMatch(prompt.system, /^# 角色$|system 中的角色/m);
    assert.equal(Object.hasOwn(route.promptModel, 'role'), false);
    assert.equal(Object.values(route.promptModel).filter(Boolean).some(stage => Object.hasOwn(stage, 'role')), false);
  }
});

test('两个文本服务实际 HTTP 原样发送并记录多轮消息，不重复原稿和意见', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '修改后的摘要' } }] }));
  });
  try {
    const url = `${await listen(server)}/v1`;
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      const ai = createAiRoutes({ readConfig: async () => ({ ...config, baseUrl: url, textBaseUrl: url, text: { model } }) });
      let saved;
      const { prompt } = await ai('project-summary', 'regenerate', { ...input, content: '原稿唯一标记', opinion: '意见唯一标记' }, { record: async value => { saved = structuredClone(value.prompt); } });
      assert.deepEqual(requests.at(-1).messages, prompt.messages);
      assert.deepEqual(saved.messages, requests.at(-1).messages);
      assert.deepEqual(saved.transfers.at(-1).request.body.messages, prompt.messages);
      assert.equal(JSON.stringify(prompt.messages).split('原稿唯一标记').length - 1, 1);
      assert.equal(JSON.stringify(prompt.messages).split('意见唯一标记').length - 1, 1);
    }
  } finally { await close(server); }
});

test('自动修订使用本任务最近原始结果；排除审核、未来和其他任务结果', () => {
  const snapshot = snapshotFixture(), project = snapshot.project;
  const task = taskFixture(project, 'project-summary', project.id, { opinion: '保留结局' });
  snapshot.steps = [
    { task_id: task.id, kind: 'generate', step_status: 'done', seq: 1, result: '第一轮结果' },
    { task_id: task.id, kind: 'revise', step_status: 'done', seq: 3, result: '最新原始结果' },
    { task_id: task.id, kind: 'review', step_status: 'rejected', seq: 4, result: { 原因: '最新审核意见' } },
    { task_id: 'other', kind: 'revise', step_status: 'done', seq: 4, result: '其他任务结果' },
    { task_id: task.id, kind: 'revise', step_status: 'done', seq: 8, result: '未来结果' },
  ];
  const prompt = renderTaskPrompt(snapshot, task, { body: '已转换的候选' }, 'regenerate', { kind: 'revise', seq: 5 });
  assert.equal(prompt.messages[2].content, '最新原始结果');
  assert.match(prompt.messages[3].content, /最新审核意见/);
  assert.doesNotMatch(prompt.body, /其他任务结果|未来结果|已转换的候选|第一轮结果/);
  const manual = renderTaskPrompt(snapshot, task, { body: '当前正式内容' }, 'regenerate');
  assert.equal(manual.messages[2].content, '当前正式内容');
});

test('同一节点 HTTP 路由四项业务输入，切换两个来源，统一返回且不写正式项目', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-ai-routes-')), calls = [];
  const upstream = source => createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({ source, auth: req.headers.authorization, path: req.url, payload: JSON.parse(raw) });
    res.end(JSON.stringify({ choices: [{ message: { content: '阿明在门口找回钥匙。' }, finish_reason: 'stop' }] }));
  });
  const remote = upstream('elysium'), local = upstream('llm-server');
  let runtime, api;
  try {
    const settings = { ...config, baseUrl: `${await listen(remote)}/v1`, textBaseUrl: `${await listen(local)}/v1`, apiKey: 'private-route-key' };
    await modelStore(home).write(settings);
    runtime = await createAppRuntime({ home });
    const project = emptyProject({ name: '节点路由', creation_mode: '剧本' }); project.script.body = input.script;
    const stored = await runtime.repository.create(project), before = stored.read();
    const sid = `session-${randomUUID()}`;
    await runtime.bindings.bind(sid, project.id);
    api = createServer(createTaskHttpHandler(runtime, { authorize: req => req.headers['x-deny'] ? 401 : null }));
    const base = await listen(api), path = '/api/meiji/ai/project-summary/generate';
    const url = `${base}${path}?session_id=${sid}&project_id=${project.id}`;
    const post = (body = input, options = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meiji-Request': '1', ...options }, body: JSON.stringify(body) });
    for (const [model, source, key] of [['codex-gpt', 'llm-server', 'ollama'], ['qwen3.5:27b', 'llm-server', 'ollama']]) {
      await runtime.models.write({ ...settings, text: { model } });
      const response = await post();
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { result: '阿明在门口找回钥匙。' });
      const call = calls.at(-1);
      assert.equal(call.source, source); assert.equal(call.auth, `Bearer ${key}`);
      assert.equal(call.path, '/v1/chat/completions'); assert.equal(call.payload.model, model);
      assert.match(call.payload.messages[1].content, /一句话概括/);
      assert.match(call.payload.messages[0].content, /不补充剧本没有写明/);
      assert.match(call.payload.messages[0].content, /输出格式/);
      assert.doesNotMatch(call.payload.messages[1].content, /输出格式/);
    }
    assert.deepEqual(stored.read(), before);
    for (const bad of [{ ...input, model: 'elysium-chat' }, { ...input, output: {} }, { ...input, script: undefined }, { ...input, language: 2 }]) assert.equal((await post(bad)).status, 422);
    assert.equal((await post(input, { 'X-Meiji-Request': '0' })).status, 403);
    assert.equal((await post(input, { Origin: 'http://elsewhere.test' })).status, 403);
    assert.equal((await post(input, { 'X-Deny': '1' })).status, 401);
    assert.equal((await fetch(`${base}${path}`, { method: 'POST', headers: { 'X-Meiji-Request': '1' }, body: JSON.stringify(input) })).status, 403);
    assert.equal((await fetch(url.replace(sid, `session-${randomUUID()}`), { method: 'POST', headers: { 'X-Meiji-Request': '1' }, body: JSON.stringify(input) })).status, 403);
    assert.equal(calls.length, 2);
  } finally {
    await runtime?.dispose();
    for (const server of [api, remote, local].filter(Boolean)) await close(server);
    await rm(home, { recursive: true, force: true });
  }
});

test('路由在调用模型前拒绝未声明动作与参数', async () => {
  let reads = 0, requests = 0;
  const ai = createAiRoutes({ readConfig: async () => { reads++; return config; }, gateway: { chat: async () => { requests++; return '结果'; } } });
  await assert.rejects(ai('script-split', 'unknown-action', input), /不存在/);
  await assert.rejects(ai('project-summary', 'generate', { ...input, prompt: '绕过' }), /未定义参数/);
  await assert.rejects(ai('project-summary', 'generate', { ...input, rules: [{}] }), /未定义参数/);
  assert.equal(reads, 0); assert.equal(requests, 0);
});

test('输出按路由契约校验，模型无法用 HTTP200 掩盖错误结构', async () => {
  const ai = createAiRoutes({ readConfig: async () => config, gateway: { chat: async () => '{"是否通过":"yes","原因":""}' } });
  await assert.rejects(ai('project-summary', 'review', { ...input, opinion: '', content: '候选' }), /boolean/);
  for (const [node, route] of Object.entries(nodeRoutes)) {
    for (const [action, contract] of Object.entries(route.actions)) {
      const prompt = composeNodePrompt(node, action, sampleInput(contract.input), 'elysium-chat');
      assert.deepEqual(prompt.output, contract.output);
      assert.notEqual(prompt.output, contract.output);
      if (node === 'video') assert.equal(Object.hasOwn(route, 'promptModel'), false);
      else assert.ok(!Object.hasOwn(route.promptModel[action].system, '输出格式'));
    }
  }
});

test('两次并发节点调用各读一次配置、保存自己的模型与提示词', async () => {
  let reads = 0, release;
  const gate = new Promise(resolve => { release = resolve; }), savedA = [], savedB = [];
  const ai = createAiRoutes({ readConfig: async () => ({ ...config, text: { model: ++reads === 1 ? 'qwen3.5:27b' : 'codex-gpt' } }), gateway: {
    chat: async ({ model, messages }) => {
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n'); if (model === 'qwen3.5:27b') await gate; else release(); return prompt.includes('请求A') ? '结果A' : '结果B'; },
  } });
  const [a, b] = await Promise.all([
    ai('project-summary', 'generate', { ...input, script: '请求A' }, { record: async row => savedA.push(structuredClone(row)) }),
    ai('project-summary', 'generate', { ...input, script: '请求B' }, { record: async row => savedB.push(structuredClone(row)) }),
  ]);
  assert.equal(reads, 2); assert.equal(a.result, '结果A'); assert.equal(b.result, '结果B');
  assert.equal(a.prompt.model, 'qwen3.5:27b'); assert.equal(b.prompt.model, 'codex-gpt');
  assert.equal(savedA[0].prompt.input.script, '请求A'); assert.equal(savedB[0].prompt.input.script, '请求B');
  assert.doesNotMatch(a.prompt.user, /请求B/); assert.doesNotMatch(b.prompt.user, /请求A/);
});

for (const [name, client, model, key] of [['elysium', elysiumClient, 'elysium-chat', 'test-only-secret'], ['llm-server', llmServerClient, 'qwen3.5:27b', 'ollama']]) {
  const options = { baseUrl: 'http://localhost/v1', apiKey: 'test-only-secret', model, messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '生成' }] };
  test(`${name} 单例重试留痕并脱敏，400 不重试`, async () => {
    let count = 0; const traces = [];
    const result = await withGatewayTrace(async row => traces.push(row), () => client.complete({ ...options, retryDelays: [0], fetchImpl: async (_, req) => {
      assert.equal(req.headers.Authorization, `Bearer ${key}`);
      const pending = traces.at(-1);
      assert.ok(pending.request); assert.equal(Object.hasOwn(pending, 'status'), false);
      if (++count === 1) return new Response('{}', { status: 503 });
      return completion('完成');
    } }));
    assert.equal(result, '完成'); assert.equal(count, 2); assert.equal(traces.length, 4);
    assert.equal(traces[1].status, 503); assert.equal(traces[3].status, 200);
    assert.ok(!JSON.stringify(traces).includes(key));
    count = 0;
    await assert.rejects(client.complete({ ...options, retryDelays: [0], fetchImpl: async () => { count++; return new Response('{}', { status: 400 }); } }), /400/);
    assert.equal(count, 1);
  });
  test(`${name} 已取消、重试等待取消和截断响应不会返回候选`, async () => {
    const cancelled = new AbortController(); cancelled.abort(new Error('已停止'));
    let count = 0;
    await assert.rejects(client.complete({ ...options, signal: cancelled.signal, fetchImpl: async () => { count++; return completion('错误'); } }), /已停止/);
    assert.equal(count, 0);
    const controller = new AbortController();
    await assert.rejects(client.complete({ ...options, retryDelays: [5000], signal: controller.signal, fetchImpl: async () => { count++; controller.abort(); return new Response('{}', { status: 503 }); } }));
    assert.equal(count, 1);
    await assert.rejects(client.complete({ ...options, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '半截' } }] })) }), /未正常完成/);
  });
}

test('修订携带最新候选和对应轮次审核意见，未来/其他任务意见不混入', () => {
  const snapshot = snapshotFixture(), p = snapshot.project, shot = p.episodes[0].shot_list.shots[0];
  for (const node of ['seconds', 'storyboard']) {
    const task = taskFixture(p, node, shot.id, { opinion: '用户要求' });
    snapshot.steps = [
      { task_id: task.id, kind: 'review', step_status: 'rejected', seq: 2, result: { 原因: '本轮审核' } },
      { task_id: task.id, kind: 'review', step_status: 'rejected', seq: 8, result: { 原因: '未来审核' } },
      { task_id: 'other', kind: 'review', step_status: 'rejected', seq: 3, result: { 原因: '其他任务' } },
    ];
    const prompt = renderTaskPrompt(snapshot, task, { marker: '最新候选' }, 'regenerate', { kind: 'revise', seq: 4 });
    assert.match(prompt.messages[2].content, /最新候选/); assert.match(prompt.user, /本轮审核/); assert.match(prompt.user, /用户要求/);
    assert.doesNotMatch(prompt.user, /未来审核|其他任务/);
  }
});

test('分镜提示词 HTTP 执行和任务转换共用路由三段式输出格式', async () => {
  const ai = createAiRoutes({ readConfig: async () => config, gateway: { chat: async () => '只有普通文本' } });
  const request = sampleInput(nodeRoutes.storyboard.actions.generate.input);
  await assert.rejects(ai('storyboard', 'generate', request), /段落标题/);
});

test('直接节点请求取消后，模型晚到结果不会返回', async () => {
  const controller = new AbortController();
  const ai = createAiRoutes({ readConfig: async () => config, gateway: { chat: async () => { controller.abort(new Error('用户取消')); return '晚到候选'; } } });
  await assert.rejects(ai('project-summary', 'generate', input, { signal: controller.signal }), /用户取消/);
});
