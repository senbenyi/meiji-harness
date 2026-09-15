// 职责：定义 ComfyUI 原子任务查询工具，不承担视频生成编排。
import { resolveServer } from '../servers/resolve.js'
import { createBackendClient } from '../servers/runtime.js'

// 固定后端映射；工具参数不接受任意 URL。
export function comfyuiTaskTool(action, description) {
  const name = `comfyui_task_${action}`
  return {
    name,
    description,
    timeoutMs: 65_000,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        server: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', description: '任务所属实例，必须与生成任务返回的服务一致。' },
        ...(action === 'queue' ? {} : {
          prompt_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$', description: 'ComfyUI 原生任务 ID，不是 model_job_status 的 job_id。' },
        }),
      },
      required: action === 'queue' ? ['server'] : ['server', 'prompt_id'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      render: (input, output) => [{ type: 'text', text: JSON.stringify({ input, output }, null, 2) }],
    },
    async execute(args, exec) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(args.server || '') ||
          (action !== 'queue' && !/^[A-Za-z0-9_-]{1,128}$/.test(args.prompt_id || '')) ||
          Object.keys(args).some(key => !['server', ...(action === 'queue' ? [] : ['prompt_id'])].includes(key))) {
        throw new Error('ComfyUI 任务参数无效')
      }
      exec?.signal?.throwIfAborted()
      const backend = resolveServer('comfyui', args.server)
      const client = await createBackendClient(backend, { signal: exec?.signal })
      try {
        const queue = await client.request('queue')
        if (action === 'queue') return { ok: true, server: args.server, ...queue }
        const history = (await client.request(`history/${args.prompt_id}`))[args.prompt_id]
        const running = queue.queue_running?.some(item => item[1] === args.prompt_id)
        const pending = queue.queue_pending?.some(item => item[1] === args.prompt_id)
        if (action === 'cancel') {
          // /interrupt affects the running queue globally. Never race another job.
          if (running) return { ok: false, error: { type: 'RUNNING_CANCEL_UNSUPPORTED', message: '原生中断接口不能安全定向取消运行中任务；本次未中断。' } }
          if (pending) await client.request('queue', { delete: [args.prompt_id] })
          return { ok: true, prompt_id: args.prompt_id, status: pending ? 'cancel_requested' : history ? 'finished' : 'not_found' }
        }
        return { ok: true, prompt_id: args.prompt_id, server: args.server,
          status: history?.status?.status_str === 'error' ? 'failed' : history?.status?.completed ? 'succeeded'
            : running ? 'running' : pending ? 'queued' : 'not_found',
          ...(action === 'result' ? { history, artifacts: Object.entries(history?.outputs || {}).flatMap(([node, output]) =>
            Object.values(output).flat().filter(file => file?.filename && file.type === 'output').map((file, index) => ({
              ...file, artifact_id: `${args.prompt_id}:${node}:${index}`, view_url: client.viewUrl(file),
            }))) } : { messages: history?.status?.messages || [] }) }
      } catch (error) {
        return { ok: false, error: { type: error.code || 'COMFYUI_REQUEST_FAILED', message: error.message } }
      }
    },
  }
}

export const createComfyuiTaskQueueTool = () => comfyuiTaskTool('queue', '查询指定 ComfyUI 实例的运行与排队任务摘要。')
export const createComfyuiTaskStatusTool = () => comfyuiTaskTool('status', '查询 ComfyUI 原生任务状态及节点错误。')
export const createComfyuiTaskResultTool = () => comfyuiTaskTool('result', '查询任务历史中的产物、派生 ID 与访问 URL；不表示文件已验收。')
export const createComfyuiTaskCancelTool = () => comfyuiTaskTool('cancel', '仅移除指定 ComfyUI 排队任务；运行中的任务不执行全局中断。')
