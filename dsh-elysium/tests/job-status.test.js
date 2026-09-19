// 职责：验证任务状态机的合法流转、终态保护与统一失败字段。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readJson } from '../src/database/json.js'
import { failStatus, saveStatus, startStatus, succeedStatus } from '../src/worker/store/status.js'

test('job status follows queued → running → failed → queued → running → succeeded and protects success', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'job-status-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await saveStatus(directory, { job_id: 'j', status: 'queued', stage: 'queued' })
  const running = await startStatus(directory, { job_id: 'j', debug: { log_path: join(directory, 'execution.log'), diagnostic_path: join(directory, 'diagnostics.json') } })
  running.stage = 'execute'
  await failStatus(directory, running, Object.assign(new Error('boom'), { code: 'REMOTE_DOWN' }), { code: 'FALLBACK', retry_scope: 'query-original' })
  const failed = await readJson(join(directory, 'status.json'))
  assert.equal(failed.status, 'failed'); assert.equal(failed.failed_stage, 'execute'); assert.equal(failed.error_code, 'REMOTE_DOWN'); assert.equal(failed.retry_scope, 'query-original')
  assert.equal(await readFile(join(directory, 'execution.log'), 'utf8'), 'boom\n')
  assert.deepEqual(await readJson(join(directory, 'diagnostics.json')), failed)

  await saveStatus(directory, { job_id: 'j', status: 'queued', stage: 'queued' })
  const retried = await startStatus(directory, { job_id: 'j' })
  assert.equal(retried.created_at, failed.created_at)
  await succeedStatus(directory, retried, { media_kind: 'video' })
  for (const status of ['queued', 'running', 'failed', 'succeeded']) {
    await assert.rejects(saveStatus(directory, { job_id: 'j', status }), { code: 'JOB_STATE_INVALID' })
  }
  assert.equal((await readJson(join(directory, 'status.json'))).result.media_kind, 'video')
})
