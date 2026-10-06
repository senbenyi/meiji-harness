import { jsonOutput, currentProject, sessionIdOf } from './operation-context-query.js'
import { goalForRunTarget } from '../shared/run-templates.js'
const goalSchema = { type: 'object', additionalProperties: false, required: ['to'], properties: {
  to: { type: 'string', enum: ['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble', 'project-summary', 'script-revise', 'script-sync'] },
  from: { type: 'string', enum: ['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble'] },
  mode: { type: 'string', enum: ['generate', 'regenerate', 'modify', 'review'] }, feedback: { type: 'string' }, requirements: { type: 'string' }, durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
  scope: { type: 'object', additionalProperties: false, properties: { only: { type: 'string', enum: ['outline', 'characters', 'scenes', 'props'] }, tracks: { type: 'array', items: { type: 'string' }, uniqueItems: true }, itemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true }, fromEpisode: { type: 'integer', minimum: 1 } } },
} }
const consent = { authorizePrereq: { type: 'array', items: { type: 'string' }, uniqueItems: true }, confirmDelete: { type: 'boolean' } }
function validate(args, properties, required) {
  if (!args || Object.keys(args).some(key => !Object.hasOwn(properties, key)) || required.some(key => args[key] === undefined)) throw new Error('工具参数缺失或不受支持')
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key]
    const valid = schema.type === 'integer' ? Number.isInteger(value) && value >= (schema.minimum || 0) : schema.type === 'array' ? Array.isArray(value) && value.every(item => typeof item === schema.items.type) && new Set(value).size === value.length : schema.type === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : typeof value === schema.type
    if (!valid || schema.enum && !schema.enum.includes(value)) throw new Error(`参数 ${key} 无效`)
  }
}
export function runTools({ home, runs, runJobs, runGoals }) {
  const specs = [
    ['run-plan', '预览制作目标，返回步骤、缺少前置、删除清单及阻断；同集已有任务时返回并入预览。不会启动执行。', [], { episodeNumber: { type: 'integer', minimum: 1 }, goal: goalSchema, authorizePrereq: consent.authorizePrereq }, ['goal']],
    ['run-confirm', '确认已预览任务。前置和删除必须有用户明确授权；返回 jobId，暂停时汇报可选动作并结束本轮。', ['runId'], consent],
    ['run-amend', '在同一任务追加目标或用户意见；目标范围与删除仍需授权。单镜意见必须明确对象。', ['runId'], { goal: goalSchema, target: { type: 'string' }, feedback: { type: 'string' }, ...consent, projectRevision: { type: 'integer', minimum: 0 } }],
    ['run-resume', '按暂停原因允许的动作恢复任务；不自动重试，不允许会话忽略审核或确认图片/剧本。', ['runId', 'action'], { action: { type: 'string', enum: ['retry', 'resume', 'authorize'] }, target: { type: 'string' }, ...consent }],
    ['run-cancel', '取消用户指定任务或对象分支；已完成内容与历史保留。', ['runId'], { target: { type: 'string' } }],
  ]
  return specs.map(([name, description, required, extra, additional = []]) => {
    const properties = { ...(name !== 'run-plan' ? { runId: { type: 'string' } } : {}), ...extra }, requiredKeys = [...required, ...additional]
    return { name, description, parameters: { type: 'object', additionalProperties: false, required: requiredKeys, properties }, output: jsonOutput,
      async execute(args, exec) {
        validate(args, properties, requiredKeys)
        const project = await currentProject(home, exec), sessionId = sessionIdOf(exec)
        if (name === 'run-plan') {
          const result = await runs.plan({ projectId: project.id, ...args }, sessionId, 'session')
          return JSON.stringify({ ...result, runId: result.run.id })
        }
        const current = await runs.get(project.id, args.runId, sessionId)
        const selected = args.target ? current.steps.filter(step => step.target === args.target && !['done', 'skipped', 'superseded', 'cancelled'].includes(step.status)).sort((a, b) => Number(b.status === 'paused') - Number(a.status === 'paused')).at(0) : null
        if (args.target && name !== 'run-amend' && !selected) throw new Error('此对象没有可处理的步骤')
        let jobId
        try {
          if (name === 'run-confirm') await runs.validateConfirm(project.id, args.runId, sessionId, args)
          if (name !== 'run-cancel') await runGoals?.attach(current, sessionId)
          if (name !== 'run-cancel') jobId = runJobs.bind(current, sessionId, { afterRevision: current.revision, source: 'session' })
          const run = name === 'run-confirm' ? await runs.confirm(project.id, args.runId, sessionId, args) : name === 'run-amend' ? await runs.amend(project.id, args.runId, sessionId, { ...args, goal: args.goal || (args.target && args.feedback ? goalForRunTarget(args.target, { feedback: args.feedback }) : undefined) }) : name === 'run-resume' ? await runs.resume(project.id, args.runId, sessionId, { ...args, stepId: selected?.id }, 'session') : await runs.cancel(project.id, args.runId, sessionId, selected?.id)
          runGoals?.observe(run)
          return JSON.stringify({ runId: run.id, status: run.status, pause: run.pause, ...(jobId ? { jobId } : {}) })
        } catch (error) { if (jobId) runJobs.detach(jobId); throw error }
      },
    }
  })
}
