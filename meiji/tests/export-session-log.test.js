import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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

for (const filename of ['session.jsonl', 'session.v4.jsonl']) test(`公开 ZIP ${filename} 识别真实会话头，只合并根会话`, async t => {
  const home = await tempHome(t), file = join(home, 'public.zip'), store = recordStore(home, 'project')
  const child = 'subagents/child/session.v4.jsonl'
  await mkdir(join(home, 'subagents/child'), { recursive: true })
  await writeFile(join(home, filename), [
    { type: 'session', version: 4, id: 'session-root', createdAt: 1 },
    { type: 'user/message', time: 1000, data: { text: '根会话需求' } },
  ].map(entry => JSON.stringify(entry)).join('\n'))
  await writeFile(join(home, child), JSON.stringify({ type: 'session', id: 'session-child' }) + '\n' + JSON.stringify({ type: 'user/message', data: { text: '子会话需求' } }))
  await promisify(execFile)('zip', ['-q', file, filename, child], { cwd: home })
  await store.update('operations', 'root', { id: 'root', sessionId: 'session-root', label: '根会话操作' })
  await store.update('operations', 'child', { id: 'child', sessionId: 'session-child', label: '子会话操作' })
  const output = await exportSessionLog({ sessionLog: file, projectId: 'project', home })
  assert.match(output, /会话：session-root/)
  assert.match(output, /根会话需求/); assert.match(output, /根会话操作/)
  assert.doesNotMatch(output, /子会话需求|子会话操作|时间未知 · session\n/)
})

test('公开 ZIP 多个根日志或只有子会话时拒绝猜测归属', async t => {
  const home = await tempHome(t), ambiguous = join(home, 'ambiguous.zip'), childOnly = join(home, 'child.zip')
  await mkdir(join(home, 'subagents/child'), { recursive: true })
  for (const filename of ['session.jsonl', 'session.v4.jsonl', 'subagents/child/session.v4.jsonl']) await writeFile(join(home, filename), '{"type":"session","id":"session-root"}\n')
  await promisify(execFile)('zip', ['-q', ambiguous, 'session.jsonl', 'session.v4.jsonl'], { cwd: home })
  await promisify(execFile)('zip', ['-q', childOnly, 'subagents/child/session.v4.jsonl'], { cwd: home })
  await assert.rejects(exportSessionLog({ sessionLog: ambiguous, projectId: 'project', home }), /多个根会话日志/)
  await assert.rejects(exportSessionLog({ sessionLog: childOnly, projectId: 'project', home }), /缺少根会话日志/)
})
