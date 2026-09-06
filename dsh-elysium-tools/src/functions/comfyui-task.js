import { execFile } from 'node:child_process'
import { join } from 'node:path'

// 固定脚本映射，参数以 argv 传入；不允许模型执行任意命令或指定任意 URL。
export function comfyuiTaskTool(action, description) {
  const name = `comfyui_task_${action}`
  return {
    name,
    description,
    timeoutMs: 65_000,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        server: { type: 'string', enum: ['production', 'minimax-h3'], description: '任务所属实例，必须与生成任务返回的服务一致。' },
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
      if (!['production', 'minimax-h3'].includes(args.server) ||
          (action !== 'queue' && !/^[A-Za-z0-9_-]{1,128}$/.test(args.prompt_id || '')) ||
          Object.keys(args).some(key => !['server', ...(action === 'queue' ? [] : ['prompt_id'])].includes(key))) {
        throw new Error('ComfyUI 任务参数无效')
      }
      exec?.signal?.throwIfAborted()
      const root = process.env.LLM_AI_MODEL_ROOT || '/root/autodl-tmp/project'
      const script = join(root, 'scripts', 'comfyui', `task_${action}.sh`)
      const argv = [script, '--server', args.server]
      if (action !== 'queue') argv.push('--prompt-id', args.prompt_id)
      return new Promise((resolve) => {
        execFile('bash', argv, { cwd: root, signal: exec?.signal, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
          let output
          try {
            output = JSON.parse(stdout)
            if (typeof output.ok !== 'boolean') throw new Error('missing ok')
            if (error && output.ok) throw error
          } catch {
            output = { ok: false, error: { type: error?.code || 'INVALID_RESPONSE',
              message: error?.name === 'AbortError' ? '调用已中止；不代表远端任务已取消。' : '任务管理脚本执行失败或未返回有效 JSON，请检查入口部署和 Python 依赖。' } }
          }
          output.debug = { ...output.debug, tool: name, input: args,
            chain: [{ stage: 'tool', tool: name }, { stage: 'script', path: script }, ...(output.debug?.chain || [])] }
          resolve(output)
        })
      })
    },
  }
}
