// 职责：轮询本地任务状态，并在完成或超时时返回统一结果。
import { getJob } from './inspect.js'
import { completedResult } from '../results/summary.js'
import { setTimeout } from 'node:timers/promises'

export async function waitJob(job, signal, read = getJob, pause = setTimeout) {
  try {
    for (;;) {
      signal?.throwIfAborted()
      const current = await read(job.job_id)
      if (current.status === 'succeeded') return completedResult(current)
      if (['failed', 'cancelled'].includes(current.status)) return current
      await pause(2000, undefined, { signal })
    }
  } catch (error) {
    throw new Error(`已停止等待，后台与远端任务未取消；job_id: ${job.job_id}；用 call_tools_job_status 查询原任务，勿重新生成。${error.message}`, { cause: error })
  }
}
