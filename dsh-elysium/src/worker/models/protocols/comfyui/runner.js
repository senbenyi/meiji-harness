// 职责：ComfyUI 任务的唯一执行流程：准备（恢复时复用已保存的图）→ 提交 → 等待 → 收集产物，网络瞬断时有限重试。
import { setTimeout } from 'node:timers/promises'
import { join } from 'node:path'
import { saveJson } from '../../../../database/json.js'
import { connectBackend, createBackendClient, withBackend } from '../../index.js'
import { prepareComfyWorkflow, runComfyWorkflow } from './execution.js'

const MAX_RETRIES = 5
const transient = error => error.name === 'TimeoutError' || error instanceof TypeError && error.message === 'fetch failed' || [408, 429, 502, 503, 504].includes(error.status)

/**
 * 平台只提供差异部分：
 *   capability               任务能力（workflow-video / workflow-image）
 *   prepare(client)          首次执行时构建 { graph, workflowName, outputNode, ... }
 *   collect(client, history, prepared, promptId) → result
 *   validation(result)       写入 validation.json 的内容，默认 result.validation
 *   recovery                 失败后给 Agent 的恢复说明
 *   timeoutMs                单次等待上限
 */
export async function runComfyJob(plan, backend, ctx, spec) {
  await connectBackend(backend)
  return withBackend(backend, () => execute(plan, backend, ctx, spec))
}

async function execute(plan, backend, ctx, { capability, prepare, collect, validation = result => result.validation, recovery, timeoutMs }) {
  const { directory, signal } = ctx, pause = ctx.pause || setTimeout
  const client = await createBackendClient(backend, { signal })
  const status = await ctx.start({ capability, backend: 'comfyui', server: backend, trace_id: ctx.jobId, parent_job_id: null,
    debug: { effective_input: plan, chain: [], diagnostic_path: join(directory, 'diagnostics.json'), log_path: join(directory, 'execution.log') } })
  for (let attempt = 0; ; attempt++) try {
    status.stage = 'prepare'
    const prepared = await prepareComfyWorkflow(directory, client, plan, () => prepare(client))
    const { promptId, history } = await runComfyWorkflow(ctx, client, prepared, status, timeoutMs)
    status.stage = 'inspect-output'
    await ctx.save(status)
    const result = await collect(client, history, prepared, promptId)
    signal?.throwIfAborted()
    await saveJson(join(directory, 'validation.json'), validation(result))
    return await ctx.succeed(status, result)
  } catch (error) {
    if (signal?.aborted) error = signal.reason
    if (!signal?.aborted && transient(error) && attempt < MAX_RETRIES) {
      status.stage = 'reconnecting'
      status.retry_attempt = attempt + 1
      await ctx.save(status)
      try { await pause(Math.min(30000, 2000 * 2 ** attempt), undefined, { signal }) } catch { error = signal.reason }
      if (!signal?.aborted) continue
    }
    await ctx.fail(status, error, { code: 'MODEL_GENERATION_FAILED', retry_scope: 'query-existing-comfyui-prompt-before-retry', recovery_instruction: recovery })
    throw error
  }
}
