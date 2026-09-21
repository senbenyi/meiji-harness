// 职责：接收项目的完整有序任务，并用 Harness 后台 Job 通知整批结束。
import { createHash } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { getJob, submit } from '../../worker/index.js'
import { mediaInvocation } from '../../session/index.js'

const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const terminal = status => ['succeeded', 'failed', 'cancelled'].includes(status)
const submissionId = exec => `s-${createHash('sha256').update(JSON.stringify([exec?.agent?.session?.id, exec?.callId])).digest('hex').slice(0, 32)}`

async function waitAll(receipt, signal) {
  for (;;) {
    if (signal.aborted) return { status: 'killed', detail: signal.reason?.message || '已停止等待' }
    const jobs = await Promise.all(receipt.tasks.map(task => getJob(task.task_id)))
    if (jobs.every(job => terminal(job.status))) return { status: 'completed', detail: `${jobs.filter(job => job.status === 'succeeded').length}/${jobs.length} 成功`,
      output: JSON.stringify({ submission_id: receipt.submission_id, lane_id: receipt.lane_id,
        tasks: jobs.map(job => ({ task_id: job.job_id, status: job.status, error_code: job.error_code })) }) }
    try { await setTimeout(2000, undefined, { signal }) } catch { /* 下一轮返回 killed */ }
  }
}

export function createCallToolsProjectProduction(ctx) {
  return [{
    name: 'call_tools_project_produce',
    description: '按给定顺序批量提交项目图片/视频任务。同一泳道严格保序，返回 Harness 后台 job_id，整批结束时会话会收到通知。',
    parameters: object({
      project_id: { type: 'string', pattern: '^(?:[a-f0-9]{8}|[0-9]{17})$' },
      tasks: { type: 'array', minItems: 1, items: object({
        kind: { type: 'string', enum: ['image', 'video'] }, plan: { type: 'object', additionalProperties: true },
        binding: { type: 'object', additionalProperties: true },
      }, ['kind', 'plan']) },
    }, ['project_id', 'tasks']),
    output: { schema: object({ job_id: { type: 'string' }, submission_id: { type: 'string' }, task_ids: { type: 'array', items: { type: 'string' } } }, ['job_id', 'submission_id', 'task_ids']),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!ctx.jobs?.start) throw new Error('Harness 后台任务服务不可用')
      const id = submissionId(exec), controller = new AbortController()
      const invocation = mediaInvocation(exec)
      const receipt = await submit({ submission_id: id, lane: { id: `project-${args.project_id}-main`, priority: 'batch' }, project_id: args.project_id,
        tasks: args.tasks, channel: 'project' }, invocation)
      const done = waitAll(receipt, controller.signal).catch(error => ({ status: 'failed', detail: error.code || error.message, output: JSON.stringify({ error: error.message }) }))
      const backgroundId = ctx.jobs.start({ kind: 'elysium', label: `项目 ${args.project_id} 生成 ${args.tasks.length} 个任务`, owner: exec.agent,
        run: () => ({ cancel: reason => controller.abort(new Error(reason || '已停止等待；生成任务仍由持久化驱动继续')), done }) })
      return { job_id: backgroundId, submission_id: receipt.submission_id, task_ids: receipt.tasks.map(task => task.task_id) }
    },
  }]
}
