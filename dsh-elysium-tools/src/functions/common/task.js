import { requiredConfig } from '../../config.js'
import { readFile } from 'node:fs/promises'
import { traceDiagnostics } from './diagnostics.js'
import { join } from 'node:path'
import { publishVideo } from '../../workflows/video-publication.js'
import { executeComfyVideo } from '../../workflows/video-execution.js'

const ARTIFACTS_ROOT = () => requiredConfig('ARTIFACTS_ROOT')
const STATE_ROOT = () => requiredConfig('ELYSIUM_TOOLS_STATE_ROOT')

async function readTrace(path) {
  const text = await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

export const MODEL_TIMEOUTS = Object.freeze({
  image: 41 * 60 * 1000,
  video: 71 * 60 * 1000,
  longVideo: 151 * 60 * 1000,
  concat: 121 * 60 * 1000,
  workflow: 451 * 60 * 1000,
})

export class ModelTaskError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'ModelTaskError'
    this.code = code
    this.status = status
  }
}

function jobRoot(jobId) {
  return join(STATE_ROOT(), 'jobs', jobId)
}

export async function executeVideoWorkflowJob(jobId, params) {
  return completedResult(await executeComfyVideo(jobId, params))
}

export async function getJob(jobId) {
  if (!/^[0-9a-f]{32}$/.test(jobId || '')) throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
  try {
    const job = JSON.parse(await readFile(join(jobRoot(jobId), 'status.json'), 'utf8'))
    if (job.capability === 'workflow-video' && job.backend !== 'comfyui') {
      await publishVideo(job)
      job.workflow = await readFile(join(ARTIFACTS_ROOT(), `production-${jobId}`, 'workflow/state.json'), 'utf8')
        .then(JSON.parse).catch(() => null)
    }
    if (job.status === 'running' && job.debug?.trace_path) {
      job.debug.chain = await readTrace(job.debug.trace_path).catch(() => job.debug.chain || [])
      Object.assign(job.debug, traceDiagnostics(job.debug.chain))
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
  return { job_id: job.job_id, status: job.status, trace_id: job.trace_id, parent_job_id: job.parent_job_id,
    stage: job.stage, timings: job.timings, code_version: job.code_version, ...job.result, debug: job.debug }
}
