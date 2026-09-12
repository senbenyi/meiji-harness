import { getJob, completedResult } from './query.js'
import { setTimeout } from 'node:timers/promises'
import { createTiming } from './timing.js'

export async function waitJob(job, signal, read = getJob, pause = setTimeout, timing = createTiming()) {
  try {
    for (;;) {
      signal?.throwIfAborted()
      const current = await timing.measure('local.read-status', () => read(job.job_id))
      if (current.status === 'succeeded') return completedResult(current)
      if (current.status === 'failed') return current
      await timing.measure('local.sleep', () => pause(2000, undefined, { signal }))
    }
  } catch (error) {
    throw new Error(`已停止等待，后台与远端任务未取消；job_id: ${job.job_id}；用 model_job_status 查询原任务，勿重新生成。${error.message}`, { cause: error })
  }
}
