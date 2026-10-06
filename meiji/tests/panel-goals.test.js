import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createPanelGoals } from '../server/host/harness-goals.js'

const harness = process.env.HARNESS_DIR || fileURLToPath(new URL('../../../deepseek-harness/', import.meta.url))
test('真实 Harness goal/driver/jobs：面板单次目标先结算再通知，读取结果后 end；冲突、恢复和取消保持边界', async () => {
  const tsx = createRequire(resolve(harness, 'package.json')).resolve('tsx/esm')
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', tsx, fileURLToPath(new URL('fixtures/panel-goals-runtime-check.mjs', import.meta.url)), harness], { cwd: harness, timeout: 30000 })
  const result = JSON.parse(stdout.trim())
  assert.deepEqual(result.terminal, ['completed', 'failed', 'cancelled'])
  assert.equal(result.extraGoalRounds, 0)
  assert.equal(result.conflictProtected, true)
  assert.equal(result.recovery, true)
  assert.equal(result.ownerDetached, true)
  assert.equal(result.unauthorizedExecutions, 0)
})

test('完成通知只读守卫只约束面板独立轮次，保留用户输入和已授权的会话流程', () => {
  const goals = createPanelGoals({}), agent = {}
  const notice = { source: { kind: 'tool-jobs', summary: 'meiji 面板单次操作 summary（完成后汇报并结束，不规划后续）' } }
  goals.beforeStep({ agent, turn: 1, messages: [notice] })
  for (const name of ['update_goal', 'create_goal', 'todo_write', 'operation-generate-story', 'job_kill']) assert.match(goals.guard({ agent, name }), /end/)
  for (const name of ['job_output', 'operation-context-query', 'get_goal']) assert.equal(goals.guard({ agent, name }), undefined)
  goals.beforeStep({ agent, turn: 1, messages: [] })
  assert.match(goals.guard({ agent, name: 'todo_write' }), /end/)
  goals.beforeStep({ agent, turn: 1, messages: [{ source: { kind: 'user' } }] })
  assert.equal(goals.guard({ agent, name: 'operation-generate-story' }), undefined)
  goals.beforeStep({ agent, turn: 2, messages: [{ source: { kind: 'user' } }] })
  goals.beforeStep({ agent, turn: 2, messages: [notice] })
  assert.equal(goals.guard({ agent, name: 'operation-generate-story' }), undefined)
  goals.beforeStep({ agent, turn: 3, messages: [{ source: { kind: 'tool-jobs', summary: 'meiji summary completed' } }] })
  assert.equal(goals.guard({ agent, name: 'todo_write' }), undefined)
})
