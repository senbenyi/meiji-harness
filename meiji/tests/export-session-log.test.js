import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tempHome } from './fixtures/model.js'
import { runStore } from '../server/data/run-store.js'
import { RUN_SCHEMA } from '../shared/run-model.js'
import { exportSessionLog } from '../scripts/export-session-log.js'

const run = (id, sessionId, extra = {}) => ({ schemaVersion: RUN_SCHEMA, id, projectId: 'project', episodeId: 'episode', sessionId, goal: {}, policy: { maxRevisions: 2 }, createdAt: new Date(1).toISOString(), events: [{ type: 'confirmed' }],
  steps: [{ id: 'step', key: 'generate@summary', kind: 'generate', target: 'summary', scope: 'project', queue: 'text', actor: 'model', after: [], status: 'done' }], ...extra })

test('公开 JSONL 与所属 meiji 历史按时间和 callId 合并，过滤其他会话', async t => {
  const home = await tempHome(t), file = join(home, 'session.jsonl'), store = runStore(home, 'project')
  await writeFile(file, [
    { id: 'session-current', createdAt: 1 },
    { type: 'user/message', time: 1000, data: { text: '用户需求' } },
    { type: 'tool/call', time: 2000, data: { callId: 'call-1', arguments: '参数'.repeat(2000), api_key: 'hidden' } },
    { type: 'command/run', time: 3000, data: { commandId: 'cmd', name: '网关日志' } },
    { type: 'command/done', time: 4000, data: { commandId: 'cmd', text: '日志结果' } },
    { type: 'assistant/message', time: 9000, data: { text: '助手完成' } },
  ].map(entry => JSON.stringify(entry)).join('\n'))
  await store.create(run('run', 'session-current', { callId: 'call-1', startedAt: new Date(5000).toISOString() }))
  await store.record('run', 'step', 'prompts', { id: 'prompt', createdAt: new Date(7000).toISOString(), messages: [{ role: 'user', content: '生成提示词' }] })
  await store.record('run', 'step', 'responses', { id: 'response', createdAt: new Date(8000).toISOString(), body: { result: '网关结果' } })
  await store.create(run('other', 'session-other', { episodeId: 'other-episode', goal: { label: '他人任务' } }))
  const output = await exportSessionLog({ sessionLog: file, projectId: 'project', home })
  assert.match(output, /用户需求/); assert.match(output, /助手完成/)
  assert.match(output, /网关日志/); assert.match(output, /日志结果/)
  assert.match(output, /meiji 原始返回/); assert.match(output, /callId=call-1/)
  assert.match(output, /已截断/); assert.doesNotMatch(output, /hidden|他人任务/)
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
  const home = await tempHome(t), file = join(home, 'public.zip'), store = runStore(home, 'project')
  const child = 'subagents/child/session.v4.jsonl'
  await mkdir(join(home, 'subagents/child'), { recursive: true })
  await writeFile(join(home, filename), [
    { type: 'session', version: 4, id: 'session-root', createdAt: 1 },
    { type: 'user/message', time: 1000, data: { text: '根会话需求' } },
  ].map(entry => JSON.stringify(entry)).join('\n'))
  await writeFile(join(home, child), JSON.stringify({ type: 'session', id: 'session-child' }) + '\n' + JSON.stringify({ type: 'user/message', data: { text: '子会话需求' } }))
  await promisify(execFile)('zip', ['-q', file, filename, child], { cwd: home })
  await store.create(run('root', 'session-root', { goal: { label: '根会话任务' } }))
  await store.create(run('child', 'session-child', { episodeId: 'child-episode', goal: { label: '子会话任务' } }))
  const output = await exportSessionLog({ sessionLog: file, projectId: 'project', home })
  assert.match(output, /会话：session-root/)
  assert.match(output, /根会话需求/); assert.match(output, /根会话任务/)
  assert.doesNotMatch(output, /子会话需求|子会话任务|时间未知 · session\n/)
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
