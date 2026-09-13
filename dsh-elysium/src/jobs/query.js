// 职责：读取本地任务状态并组装已完成结果。
import { workerAlive } from '../video/worker-owner.js'
import { readFile, stat } from 'node:fs/promises'
import { traceDiagnostics } from './diagnostics.js'
import { join } from 'node:path'
import { ModelTaskError } from './errors.js'
import { findJobRoot } from './paths.js'

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
      job.debug.chain = await readTrace(job.debug.trace_path).catch(() => job.debug.chain || [])
      Object.assign(job.debug, traceDiagnostics(job.debug.chain))
    }
    if (job.backend === 'comfyui' && ['queued', 'running'].includes(job.status)) {
      try {
        if (job.status === 'queued' && Date.now() - (await stat(join(located.directory, 'status.json'))).mtimeMs < 60_000) return job
        if (!await workerAlive(join(located.directory, 'worker.lock'), jobId)) {
          const latest = JSON.parse(await readFile(join(located.directory, 'status.json'), 'utf8'))
          if (latest.status !== job.status || latest.stage !== job.stage) return latest
          job.failed_stage = job.stage
          job.status = 'failed'; job.stage = 'failed'; job.error_code = 'WORKER_NOT_RUNNING'
          job.error = '本地处理进程已停止；远端状态请按原 prompt_id 核对，使用恢复工具继续，勿重新生成。'
        }
      } catch { /* Unknown process identity does not authorize declaring it stopped. */ }
    }
    return job
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
    throw error
  }
}

export function completedResult(job) {
  if (job.status !== 'succeeded' || !job.result) {
    throw new ModelTaskError('MODEL_JOB_NOT_READY', `任务尚未成功：${job.status}`, 409)
  }
  const output = { job_id: job.job_id, status: job.status, trace_id: job.trace_id, parent_job_id: job.parent_job_id,
    stage: job.stage, timings: job.timings, code_version: job.code_version, ...job.result, debug: job.debug }
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined))
}
