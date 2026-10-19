import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { taskRequest, taskHeaders } from '../server/http/llm-server/task-request.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { TaskService } from '../server/flow/tasks/task-manager.js';
import { createAiRoutes } from '../server/http/ai-routes.js';
import { llmServerClient } from '../server/http/llm-server/client.js';
import { createTextHandler } from '../server/handlers/text-handler.js';
import { createHandlerRegistry } from '../server/handlers/handler-registry.js';
import { commitContent } from '../server/handlers/content.js';
import { projectFixture } from './fixtures/project.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const request = { url: new URL('http://original/v1/chat/completions'), headers: taskHeaders({}, { id: 'step_test' }), body: {} };
const recovering = () => ({ id: 'step_test', recovering: true, http: [{ request: { path: request.url.href, headers: request.headers } }] });

test('服务端已完成但受理响应丢失：按原步骤查询取回，提交仅一次', async () => {
  const methods = [];
  const result = await taskRequest(request, { step: { id: 'step_test' }, pollIntervalMs: 1, fetchImpl: async (url, options) => {
    methods.push(options.method || 'GET');
    if (options.method === 'POST') throw new Error('响应丢失');
    return String(url).endsWith('/result') ? json({ value: '原结果' }) : json({ status: 'succeeded' });
  } });
  assert.deepEqual(await result.json(), { value: '原结果' });
  assert.deepEqual(methods, ['POST', 'GET', 'GET']);
});

test('恢复时网络未知继续查询、queued/running继续等待，成功后取结果且不POST', async () => {
  const states = ['network', 'queued', 'running', 'succeeded'];
  const seen = [];
  const result = await taskRequest({ ...request, url: new URL('http://changed/v1/chat/completions') }, {
    step: recovering(), pollIntervalMs: 1, fetchImpl: async (url, options) => {
      seen.push(String(url)); assert.notEqual(options.method, 'POST');
      assert.ok(new URL(url).pathname.startsWith('/v1/tasks/step_test'));
      if (String(url).endsWith('/result')) return json({ ok: true });
      const status = states.shift(); if (status === 'network') throw new Error('离线');
      return json({ status });
    },
  });
  assert.deepEqual(await result.json(), { ok: true });
  assert.ok(seen.every(url => url.startsWith('http://original/')));
});

for (const state of ['failed', 'cancelled', 'interrupted', 'missing', 'expired']) {
  test(`恢复 ${state} 明确结束且不重新生成`, async () => {
    await assert.rejects(taskRequest(request, { step: recovering(), pollIntervalMs: 1, fetchImpl: async (url, options) => {
      assert.notEqual(options.method, 'POST');
      if (state === 'missing' || String(url).endsWith('/result')) return json({}, 404);
      return json({ status: state === 'expired' ? 'succeeded' : state, error: `原请求${state}` });
    } }), /原请求|过期/);
  });
}

for (const reason of ['用户取消', '服务关闭']) {
  test(`${reason}：${reason === '用户取消' ? '显式停止远端请求' : '仅中断本地等待'}`, async () => {
    const controller = new AbortController(), seen = [];
    await assert.rejects(taskRequest(request, { step: recovering(), signal: controller.signal, pollIntervalMs: 1,
      fetchImpl: async (url, options) => {
        seen.push({ url: String(url), method: options.method });
        if (String(url).endsWith('/stop')) return json({}, 202);
        controller.abort(new Error(reason)); return json({ status: 'running' });
      },
    }), new RegExp(reason));
    assert.equal(seen.some(row => row.url.endsWith('/stop')), reason === '用户取消');
  });
}

for (const kind of ['image', 'video']) {
  test(`恢复${kind}从服务端取回完整结果，不使用已脱敏的HTTP正文或重新生成`, async () => {
    const step = recovering();
    step.http[0].request.path = `http://original/v1/${kind === 'image' ? 'images' : 'videos'}/generations`;
    const options = { baseUrl: 'http://changed/v1', step, prompt: '原提示词', aspectRatio: '16:9', pollIntervalMs: 1,
      fetchImpl: async (url, requestOptions) => {
        assert.notEqual(requestOptions.method, 'POST');
        assert.ok(String(url).startsWith('http://original/v1/tasks/'));
        if (!String(url).endsWith('/result')) return json({ status: 'succeeded' });
        return json(kind === 'image' ? { data: [{ b64_json: Buffer.from('完整图片数据').toString('base64') }] }
          : { task_id: 'remote', status: 'succeeded', url: 'https://example.com/old-video.mp4' });
      },
    };
    if (kind === 'image') {
      const bytes = await llmServerClient.generateImage({ ...options, model: 'gpt-image' });
      assert.equal(bytes.toString(), '完整图片数据');
    } else {
      const video = await llmServerClient.generateVideo({ ...options, model: 'MiniMax-H3', duration: 5, mode: 'text' });
      assert.equal(video.url, 'https://example.com/old-video.mp4');
    }
  });
}

test('恢复步骤缺少原请求记录时明确停止，不发起新生成', async () => {
  await assert.rejects(taskRequest(request, { step: { id: 'step_test', recovering: true }, fetchImpl: async () => assert.fail('不能发起网络生成') }), /没有可恢复/);
});

for (const heldPhase of ['generate', 'review']) {
  test(`App后端在${heldPhase}中重启，按原请求取回并完成审核，AI不重复执行`, { timeout: 10000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'meiji-recovery-'));
    const records = new Map(); let released = false, service, repository;
    const server = createServer(async (req, res) => {
      const reply = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const id = req.headers['x-task-id'];
        assert.equal(req.headers['idempotency-key'], id);
        assert.equal(records.has(id), false, '同一步骤不能重复生成');
        const phase = records.size === 0 ? 'generate' : 'review';
        records.set(id, { phase, content: phase === 'generate' ? '恢复后取得的原正文' : JSON.stringify({ 是否通过: true, 类型: '', 原因: '' }) });
        return reply({ task_id: id }, 202);
      }
      const id = req.url.split('/')[3], record = records.get(id);
      if (!record) return reply({}, 404);
      if (req.url.endsWith('/result')) return reply({ choices: [{ message: { content: record.content }, finish_reason: 'stop' }] });
      return reply({ status: record.phase === heldPhase && !released ? 'running' : 'succeeded' });
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const config = { textBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, text: { model: 'qwen3.5:27b' }, image: { model: 'gpt-image' }, video: { model: 'MiniMax-H3' } };
    const ai = createAiRoutes({ readConfig: async () => config, gateway: { chat: options => llmServerClient.complete({ ...options, pollIntervalMs: 1 }) } });
    const start = () => new TaskService({ repository, commitOutput: commitContent,
      execute: createHandlerRegistry({ text: createTextHandler({ ai }) }) });
    try {
      repository = new ModelRepository(root);
      const project = projectFixture(); let model = await repository.create(project);
      service = start();
      const submitted = await service.command({ type: 'submit', project_id: project.id, request_id: 'start', business_type: 'project-summary', target_id: project.id, action: 'regenerate' });
      for (let i = 0; i < 500 && ![...records.values()].some(row => row.phase === heldPhase); i++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.ok([...records.values()].some(row => row.phase === heldPhase), JSON.stringify(model.readAll().tasks));
      await service.dispose();
      assert.equal(model.readAll().tasks.find(row => row.id === submitted.task_id).task_status, 'running');
      await repository.close();
      released = true;
      repository = new ModelRepository(root); model = await repository.open(project.id); service = start();
      await service.recover(model); await service.idle(project.id);
      const result = model.readAll();
      assert.equal(result.tasks.find(row => row.id === submitted.task_id).task_status, 'completed', JSON.stringify(result.tasks));
      assert.equal(result.project.project_summary.body, '恢复后取得的原正文');
      assert.equal(records.size, 2, '仅生成和AI审核各执行一次');
    } finally {
      await service?.dispose(); await repository?.close();
      await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
      await rm(root, { recursive: true, force: true });
    }
  });
}
