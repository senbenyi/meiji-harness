import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from './fixtures/model.js'
import { recordStore, TASK_SCHEMA } from '../server/data/task-store.js'
import { exportSessionLog } from '../scripts/export-session-log.js'

test('公开 JSONL 与所属 meiji 历史按时间和 callId 合并，过滤其他会话', async t => {
  const home = await tempHome(t), file = join(home, 'session.jsonl'), store = recordStore(home, 'project')
  await writeFile(file, [
    { id: 'session-current', createdAt: 1 },
    { type: 'user/message', time: 1000, data: { text: '用户需求' } },
    { type: 'tool/call', time: 2000, data: { callId: 'call-1', arguments: '参数'.repeat(2000), api_key: 'hidden' } },
    { type: 'command/run', time: 3000, data: { commandId: 'cmd', name: '网关日志' } },
    { type: 'command/done', time: 4000, data: { commandId: 'cmd', text: '日志结果' } },
    { type: 'assistant/message', time: 9000, data: { text: '助手完成' } },
  ].map(entry => JSON.stringify(entry)).join('\n'))
  await store.update('operations', 'op', { id: 'op', sessionId: 'session-current', callId: 'call-1', startedAt: new Date(5000).toISOString() })
  await store.update('tasks', 'task', { id: 'task', schemaVersion: TASK_SCHEMA, operationId: 'op', nodes: [], startedAt: new Date(6000).toISOString() })
  await store.update('prompts', 'prompt', { id: 'prompt', taskId: 'task', createdAt: new Date(7000).toISOString(), messages: [{ role: 'user', content: '生成提示词' }] })
  await store.update('responses', 'response', { id: 'response', taskId: 'task', createdAt: new Date(8000).toISOString(), body: { result: '网关结果' } })
  await store.update('operations', 'other', { id: 'other', sessionId: 'session-other', label: '他人操作' })
  const output = await exportSessionLog({ sessionLog: file, projectId: 'project', home })
  assert.match(output, /用户需求/); assert.match(output, /助手完成/)
  assert.match(output, /网关日志/); assert.match(output, /日志结果/)
  assert.match(output, /meiji 原始返回/); assert.match(output, /callId=call-1/)
  assert.match(output, /已截断/); assert.doesNotMatch(output, /hidden|他人操作/)
  assert.ok(output.indexOf('生成提示词') < output.indexOf('网关结果'))
})

test('损坏公开导出明确报行号，缺会话标识拒绝猜测归属', async t => {
  const home = await tempHome(t), file = join(home, 'session.jsonl')
  await writeFile(file, '{"id":"session"}\n{bad}')
  await assert.rejects(exportSessionLog({ sessionLog: file, projectId: 'project', home }), /第 2 行/)
  await writeFile(file, '{"type":"user/message","data":{}}')
  await assert.rejects(exportSessionLog({ sessionLog: file, projectId: 'project', home }), /缺少会话 ID/)
})
