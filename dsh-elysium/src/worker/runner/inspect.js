// 职责：定位并读取本地任务状态，识别已停止的 worker。
import { workerAlive } from './owner.js'
import { readFile, stat } from 'node:fs/promises'
import { traceDiagnostics } from '../results/diagnostics.js'
import { isAbsolute, join } from 'node:path'
import { ModelTaskError } from '../../utils/errors.js'
import { findJobRoot } from '../store/paths.js'
import { saveStatus } from '../store/status.js'
import { heartbeatStale } from './heartbeat.js'
import { appendHistory } from '../store/history.js'
import { readJson, saveJson } from '../../database/json.js'

async function requireRecovery(directory, job, reason) {
  job.recovery_required = true
  job.recovery_reason = reason
  if (!await readJson(join(directory, 'recovery-required.json'))) {
    await saveJson(join(directory, 'recovery-required.json'), { reason, detected_at: new Date().toISOString() })
    await appendHistory(directory, 'recovery-required', { reason, status: job.status, stage: job.stage })
  }
}

async function readTrace(path) {
  const text = await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

export async function getJob(jobId) {
  if (!/^[0-9a-f]{32}$/.test(jobId || '')) throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
  try {
    const located = await findJobRoot(jobId)
    if (!located) throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
    const job = JSON.parse(await readFile(join(located.directory, 'status.json'), 'utf8'))
    job.project_id ||= located.projectId
    if (job.status === 'running' && job.debug?.trace_path) {
      const trace = isAbsolute(job.debug.trace_path) ? job.debug.trace_path : join(located.directory, job.debug.trace_path)
      job.debug.chain = await readTrace(trace).catch(() => job.debug.chain || [])
      Object.assign(job.debug, traceDiagnostics(job.debug.chain))
    }
    if ((job.server?.provider || job.backend === 'comfyui') && ['queued', 'running'].includes(job.status)) {
      try {
        if (job.status === 'queued' && Date.now() - (await stat(join(located.directory, 'status.json'))).mtimeMs < 60_000) return job
        const alive = await workerAlive(join(located.directory, 'worker.lock'), jobId)
        if (alive && await heartbeatStale(located.directory)) await requireRecovery(located.directory, job, 'WORKER_HEARTBEAT_STALE')
        if (!alive) {
          const latest = JSON.parse(await readFile(join(located.directory, 'status.json'), 'utf8'))
          if (latest.status !== job.status || latest.stage !== job.stage) return latest
          job.failed_stage = job.stage
          job.status = 'failed'; job.stage = 'failed'; job.error_code = 'WORKER_NOT_RUNNING'
          job.error = '本地处理进程已停止；远端状态请按原 prompt_id 核对，使用恢复工具继续，勿重新生成。'
          job.finished_at = new Date().toISOString()
          await saveStatus(located.directory, job)
          await appendHistory(located.directory, 'worker-missing', { failed_stage: job.failed_stage })
        }
      } catch (error) {
        if (error.code === 'WORKFLOW_RECOVERY_REQUIRED') await requireRecovery(located.directory, job, 'WORKER_IDENTITY_UNKNOWN')
        else throw error
      }
    }
    return job
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
    throw error
  }
}
