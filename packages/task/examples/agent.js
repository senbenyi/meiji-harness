import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskManager, NodeStateModel } from '@agent-modules/task';
import { SQLiteTaskStore } from '@agent-modules/task/sqlite';
import { composeMessages } from '@agent-modules/prompt-composer';
import { requestData } from '@agent-modules/http-client';

// 真实本地 HTTP + SQLite，无业务项目、供应商密钥或真实模型。
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  assert.equal(JSON.parse(body).messages.at(-1).content, '整理资料');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ text: '模拟模型结果' }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'task-example-'));
const file = join(directory, 'task.sqlite');
let store, manager;
try {
  store = new SQLiteTaskStore(file);
  store.database.exec('CREATE TABLE results(task_id TEXT PRIMARY KEY,body TEXT NOT NULL)');
  manager = new TaskManager({ store, nodes: { summarize: {
    label: '资料整理',
    plan: () => [{ name: '生成', kind: 'generate', executor: 'ai' }],
    async execute({ recordPrompt, recordHttp, signal }) {
      const { messages } = composeMessages({ system: '仅使用给定资料。', user: '整理资料' });
      recordPrompt({ model: 'mock-model', messages, input: { topic: '演示' } });
      const response = await requestData({ url: `http://127.0.0.1:${server.address().port}/model`, body: { messages } }, { signal, record: recordHttp });
      if (!response.ok) throw Error(`HTTP ${response.response.status}`);
      return { result: response.data.text };
    },
    commit({ task, result, database }) {
      database.prepare('INSERT INTO results VALUES(?,?)').run(task.id, result);
    },
  } } });
  const group = manager.submit('any-business-scope', { group: { name: '独立 Agent 演示', metadata: { project_id: 'example-project' } }, tasks: [
    { node_type: 'summarize', name: '整理资料', metadata: { target_id: 'document', opinion: '' } },
  ] });
  await manager.idle('any-business-scope');
  const detail = manager.detail('any-business-scope', group.group.id);
  assert.equal(detail.status, 'completed');
  assert.equal(detail.steps[0].http.length, 1);
  assert.equal(detail.steps[0].http[0].prompt_id, detail.steps[0].prompt.id);
  assert.equal(detail.steps[0].http[0].status, 200);
  assert.equal(store.database.prepare('SELECT body FROM results').get().body, '模拟模型结果');
  assert.deepEqual(new NodeStateModel().toJSON(), { status: 'empty', reason: '', dependency_hash: '' });
  await manager.dispose(); manager = null; store.close(); store = new SQLiteTaskStore(file);
  assert.equal(store.detail('any-business-scope', group.group.id).steps[0].prompt.messages.length, 2);
  console.log('独立 task 接入通过：业务注册 → 调度 → 提示词 → 真实模拟 HTTP → 原子写回 → SQLite 重开。');
} finally {
  await manager?.dispose(); store?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
