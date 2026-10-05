import { materialize } from '../shared/episode-rules.js'
import { operations } from '../server/flow/operations/operation-registry.js'
import { operationDeletes } from '../shared/operation-cascade.js'
import { jsonOutput, sessionIdOf, currentProject } from './session-context-query-tool.js'

export function operationTools({ home, jobs }) {
  const names = new Set()
  return Object.entries(operations).filter(([, definition]) => definition.session).map(([action, definition]) => {
    const spec = definition.session
    if (names.has(spec.tool)) throw new Error(`重复工具名：${spec.tool}`)
    names.add(spec.tool)
    const properties = { requirements: { type: 'string' }, confirmDelete: { type: 'boolean' }, ...spec.params,
      ...(spec.episode ? { episodeNumber: { type: 'integer', minimum: 1 } } : {}),
      ...(spec.modes ? { mode: { type: 'string', enum: spec.modes }, ...(spec.modes.includes('modify') ? { review: { type: 'string' } } : {}) } : {}) }
    return { name: spec.tool, description: `${spec.description} 返回 jobId 后可结束本轮，或用 job_wait/job_read 查询；仅 completed 且 reviewPassed=true 可推进。`,
      parameters: { type: 'object', additionalProperties: false, required: [...(spec.episode ? ['episodeNumber'] : []), ...(spec.modes ? ['mode'] : []), ...(spec.required || [])], properties }, output: jsonOutput,
      async execute(args, exec) {
        if (Object.keys(args).some(key => !Object.hasOwn(properties, key))) throw new Error('不支持的工具参数')
        for (const [key, value] of Object.entries(args)) {
          const schema = properties[key]
          const valid = schema.type === 'integer' ? Number.isInteger(value) && value >= (schema.minimum ?? -Infinity) : schema.type === 'array' ? Array.isArray(value) && value.every(item => typeof item === schema.items.type) && (!schema.uniqueItems || new Set(value).size === value.length) : typeof value === schema.type
          if (!valid || schema.enum && !schema.enum.includes(value)) throw new Error(`工具参数 ${key} 无效`)
        }
        if (spec.modes && !spec.modes.includes(args.mode)) throw new Error('生成模式无效')
        if (args.mode === 'modify' && !args.review?.trim()) throw new Error('定向修改需要本次修改意见 review')
        if (args.mode !== 'modify' && args.review !== undefined) throw new Error('review 只用于定向修改，生成要求放入 requirements')
        for (const key of spec.required || []) if (!String(args[key] || '').trim()) throw new Error(`必须填写 ${key}`)
        const project = await currentProject(home, exec), sessionId = sessionIdOf(exec)
        const episode = [...project.episodes].reverse()[args.episodeNumber - 1]
        if (spec.episode && (!Number.isInteger(args.episodeNumber) || args.episodeNumber < 1 || !episode && !(action === 'summary' && args.mode === 'generate' && args.episodeNumber === project.episodes.length + 1))) throw new Error('目标剧集不存在，不能跳集')
        const op = { ...args, action, origin: 'session', projectId: project.id, episodeId: spec.episode ? episode?.id : undefined, sessionId, callId: exec.callId, generationMode: args.mode === 'modify' ? 'modify' : 'regenerate' }
        delete op.episodeNumber
        const view = episode && definition.scope !== 'project' ? materialize(project, episode.id) : project
        const deletions = args.mode === 'generate' && definition.completed?.(view, op) ? [] : operationDeletes(project, op)
        if (deletions.length && args.confirmDelete !== true) return JSON.stringify({ status: 'needs_confirmation', deletions, message: '先向用户说明删除清单，获得授权后带 confirmDelete=true 重发' })
        try { return JSON.stringify(await jobs.start(op, exec.agent.session)) }
        catch (error) {
          if (error.code === 'OPERATION_BUSY') return JSON.stringify({ ...jobs.waitBusy(project.id, error.busy.operationId, sessionId), busy: error.busy, message: error.message })
          if (error.code === 'SCRIPT_PENDING') return JSON.stringify({ ...jobs.waitScript(project.id, sessionId), blockers: error.blockers, message: error.message })
          throw error
        }
      },
    }
  })
}
export function waitImagesTool({ home, jobs }) {
  return { name: 'meiji_wait_images', description: '等待指定剧集卡片的图片全部确认，返回等待 job。取消等待不会改图片。', parameters: { type: 'object', additionalProperties: false, required: ['episodeNumber'], properties: { episodeNumber: { type: 'integer', minimum: 1 }, itemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true } } }, output: jsonOutput,
    async execute(args, exec) { const project = await currentProject(home, exec), episode = [...project.episodes].reverse()[args.episodeNumber - 1]; if (!Number.isInteger(args.episodeNumber) || !episode) throw new Error('目标剧集不存在'); return JSON.stringify(jobs.waitImages(project.id, episode.id, args.itemIds, sessionIdOf(exec))) } }
}
