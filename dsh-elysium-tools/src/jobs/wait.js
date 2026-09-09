import { getJob, completedResult } from './query.js'
import { setTimeout } from 'node:timers/promises'

export async function waitJob(job, signal, read = getJob, pause = setTimeout) {
  try {
    for (;;) {
      signal?.throwIfAborted()
      const current = await read(job.job_id)
      if (current.status === 'succeeded') return completedResult(current)
      if (current.status === 'failed') return current
      await pause(2000, undefined, { signal })
    }
  } catch (error) {
    throw new Error(`等待任务中断；job_id: ${job.job_id}；用 model_job_status 查询原任务，勿重新生成。${error.message}`, { cause: error })
  }
}
