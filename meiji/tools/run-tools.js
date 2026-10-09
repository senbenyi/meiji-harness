import { jsonOutput, currentProject, sessionIdOf } from './operation-context-query.js'
import { goalForRunTarget } from '../shared/run-templates.js'
const goalSchema = { type: 'object', additionalProperties: false, required: ['to'], properties: {
  to: { type: 'string', enum: ['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble', 'project-characters', 'project-summary', 'script-revise', 'script-sync'] },
  from: { type: 'string', enum: ['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble'] },
  mode: { type: 'string', enum: ['generate', 'regenerate', 'modify', 'review'] }, feedback: { type: 'string' }, requirements: { type: 'string' }, durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
  scope: { type: 'object', additionalProperties: false, properties: { only: { type: 'string', enum: ['outline', 'characters', 'scenes', 'props'] }, tracks: { type: 'array', items: { type: 'string' }, uniqueItems: true }, itemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true }, fromEpisode: { type: 'integer', minimum: 1 } } },
} }
const stepsOf = steps => { const counts = new Map(); for (const step of steps.filter(item => item.status !== 'skipped')) counts.set(step.target, (counts.get(step.target) || 0) + 1); return [...counts].map(([target, count]) => `${target}×${count}`) }
const stateOf = run => ({ runId: run.id, status: run.status, pause: run.pause?.reasons.map(reason => ({ code: reason.code, target: reason.target, message: reason.message, actions: reason.actions })) || [] })
// 多余参数直接忽略，缺少必填或类型不符才拒绝：避免模型因附带无关字段反复失败。
function validate(args, properties, required) {
  if (!args || typeof args !== 'object' || required.some(key => args[key] === undefined)) throw new Error(`工具参数缺失：需要 ${required.join('、')}`)
  const accepted = {}
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key]
    if (!schema) continue
    const valid = schema.type === 'integer' ? Number.isInteger(value) && value >= (schema.minimum || 0) : schema.type === 'array' ? Array.isArray(value) && value.every(item => typeof item === schema.items.type) && new Set(value).size === value.length : schema.type === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : typeof value === schema.type
    if (!valid || schema.enum && !schema.enum.includes(value)) throw new Error(`参数 ${key} 无效`)
    accepted[key] = value
  }
  return accepted
}
export function runTools({ home, runs, runJobs, runGoals }) {
  const specs = [
    ['run-plan', '提交制作目标并立即执行，返回 jobId。用户的请求（生成、重新生成、按意见修改、一键做到）已经包含对所需前置和连带删除的同意：缺少的前置自动纳入，被替换的旧内容自动清理，同集已有任务时自动并入，都不需要再询问用户。只有返回 blockers 时没有执行。', [], { episodeNumber: { type: 'integer', minimum: 1 }, goal: goalSchema }, ['goal']],
    ['run-amend', '用户对进行中或暂停中任务的某个对象提出修改意见时使用：target 为对象（如 outline、shots、seconds:S03），feedback 为用户原话。不要用它转述确认或重新生成；重新生成或任务已结束时用 run-plan。', ['runId', 'target', 'feedback'], { target: { type: 'string' }, feedback: { type: 'string' } }],
    ['run-resume', '任务暂停（paused）后按用户选择继续：authorize 补做缺少的前置，resume 解除用户暂停。都不需要 target；只带 runId 和 action。任务未通过（failed）已经结束，不能在原任务继续，用 run-plan 重新发起。会话不能忽略审核，也不能确认图片或剧本方案。', ['runId', 'action'], { action: { type: 'string', enum: ['resume', 'authorize'] }, target: { type: 'string' } }],
    ['run-cancel', '取消用户指定的任务或对象分支；已完成内容与历史保留。', ['runId'], { target: { type: 'string' } }],
  ]
  return specs.map(([name, description, required, extra, additional = []]) => {
    const properties = { ...(name !== 'run-plan' ? { runId: { type: 'string' } } : {}), ...extra }, requiredKeys = [...required, ...additional]
    return { name, description, parameters: { type: 'object', additionalProperties: false, required: requiredKeys, properties }, output: jsonOutput,
      async execute(input, exec) {
        const args = validate(input, properties, requiredKeys)
        const project = await currentProject(home, exec), sessionId = sessionIdOf(exec)
        const observe = async (before, run) => {
          let jobId
          if (!['completed', 'cancelled'].includes(run.status)) { await runGoals?.attach(run, sessionId); jobId = runJobs.bind(run, sessionId, { afterRevision: before, source: 'session' }) }
          runGoals?.observe(run)
          return jobId
        }
        if (name === 'run-plan') {
          // 预览 → 把缺少的前置全部纳入后重新预览（纳入前置可能带出新的前置）→ 没有硬阻断就直接执行。
          let preview = await runs.plan({ projectId: project.id, ...args, callId: exec.callId }, sessionId, 'session'), keys = []
          const id = preview.run.id, amend = Boolean(preview.amend), before = preview.run.revision
          for (let round = 0; round < 4; round++) {
            const wanted = preview.prereq.map(item => item.key)
            if (wanted.every(key => keys.includes(key))) break
            keys = [...new Set([...keys, ...wanted])]
            preview = { ...preview, ...await runs.preview(project.id, id, sessionId, { authorizePrereq: keys, ...(amend ? { goal: args.goal } : {}) }) }
          }
          if (preview.blockers.length) {
            if (!amend) await runs.cancel(project.id, id, sessionId)
            return JSON.stringify({ started: false, blockers: preview.blockers.map(item => item.message) })
          }
          let run = amend ? await runs.amend(project.id, id, sessionId, { goal: args.goal, authorizePrereq: keys, confirmDelete: true }) : await runs.confirm(project.id, id, sessionId, { authorizePrereq: keys, confirmDelete: true })
          if (run.status === 'draft') run = await runs.confirm(project.id, id, sessionId, { confirmDelete: true })
          const jobId = await observe(before, run)
          return JSON.stringify({ started: true, ...stateOf(run), merged: amend, steps: stepsOf(preview.steps || preview.run.steps), includedPrereq: preview.prereq.filter(item => keys.includes(item.key)).map(item => item.message), deleted: preview.deletions.map(item => `${item.label || item.kind}${item.track ? ' ' + item.track : ''}`), ...(jobId ? { jobId } : {}) })
        }
        const current = await runs.get(project.id, args.runId, sessionId)
        try {
          const selected = args.target ? current.steps.filter(step => step.target === args.target && !['done', 'skipped', 'superseded', 'cancelled'].includes(step.status)).sort((a, b) => Number(b.status === 'paused') - Number(a.status === 'paused')).at(0) : null
          if (name === 'run-cancel' && args.target && !selected) throw new Error('此对象没有可取消的步骤')
          const run = name === 'run-amend' ? await runs.amend(project.id, args.runId, sessionId, { goal: goalForRunTarget(args.target, { feedback: args.feedback }), confirmDelete: true })
            : name === 'run-resume' ? await runs.resume(project.id, args.runId, sessionId, { action: args.action, stepId: selected?.status === 'paused' ? selected.id : undefined, confirmDelete: true }, 'session')
              : await runs.cancel(project.id, args.runId, sessionId, selected?.id)
          const jobId = name === 'run-cancel' ? undefined : await observe(current.revision, run)
          return JSON.stringify({ ...stateOf(run), ...(jobId ? { jobId } : {}) })
        } catch (error) {
          // 报错附上任务当前状态与可用动作，便于直接向用户说明，而不是重复同一调用。
          const state = stateOf(current), actions = [...new Set(state.pause.flatMap(reason => reason.actions))]
          error.message = `${error.message}。任务当前状态：${state.status}${state.pause.length ? `；暂停原因：${state.pause.map(reason => `${reason.target || '任务'}（${reason.message}）`).join('；')}；可用动作：${actions.join('、')}` : ''}。请勿重复相同调用，把情况告诉用户。`
          throw error
        }
      },
    }
  })
}
