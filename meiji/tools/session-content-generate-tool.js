import { generationFeedback } from '../server/flow/operations/operation-manager.js'
import { jsonOutput, sessionIdOf, currentProject } from './session-context-query-tool.js'

const stages = { summary: 'episode-generate', story: 'outline', shots: 'shots', seconds: 'seconds', storyboard: 'storyboard' }
export function contentGenerateTool({ home, tasks }) {
  return {
    name: 'meiji_content_generate',
    description: '返回 operationId，用 meiji_task_control wait 等待结果。本集已被占用时返回 status=busy 与占用者 operationId：告知用户，用 meiji_task_control wait 该 operationId 直到结束后再重新发起，不要重复提交。执行一个制作步骤：summary 本集摘要；story 一次生成大纲、角色、场景；shots 镜头表；seconds 每秒指令；storyboard 文本分镜。多步骤由你用 todo_write 规划并依次调用。首次 generate；明确重做 regenerate；按意见局部修改 modify。requirements 是本次创作要求，review 仅为修订意见。返回 running 后用 meiji_task_control wait 等待；只有 completed 且 reviewPassed=true 才推进后续步骤。生成、审核、最多一次自动修订由原流程处理，不自行重复提交。',
    parameters: { type: 'object', additionalProperties: false, required: ['stage', 'episodeNumber', 'mode'], properties: {
      stage: { type: 'string', enum: Object.keys(stages) }, episodeNumber: { type: 'integer', minimum: 1 },
      mode: { type: 'string', enum: ['generate', 'regenerate', 'modify'] }, requirements: { type: 'string' }, review: { type: 'string' },
    } }, output: jsonOutput,
    async execute(args, exec) {
      const project = await currentProject(home, exec), sessionId = sessionIdOf(exec)
      if (!stages[args.stage] || !['generate', 'regenerate', 'modify'].includes(args.mode)) throw new Error('生成阶段或模式无效')
      if (!Number.isInteger(args.episodeNumber) || args.episodeNumber < 1) throw new Error('集数需为正整数')
      const episode = [...project.episodes].reverse()[args.episodeNumber - 1]
      if (!episode && !(args.stage === 'summary' && args.mode === 'generate' && args.episodeNumber === project.episodes.length + 1)) throw new Error('目标剧集不存在；请先生成下一集摘要，不能跳集')
      if (args.mode === 'modify' && !args.review?.trim()) throw new Error('定向修改需要本次修改意见')
      if (args.mode !== 'modify' && args.review) throw new Error('生成要求请放入 requirements；review 只用于修订')
      const action = stages[args.stage]
      if (episode && args.mode === 'generate') {
        const value = generationFeedback(episode, action)
        const exists = args.stage === 'summary' ? Boolean(episode.summary.content) : args.stage === 'story' ? Boolean(episode.plot.outline.content) : args.stage === 'shots' ? episode.shots.items.length > 0 : episode.shots.items.some(shot => Boolean(shot[args.stage].content))
        if (exists) {
          if (value.check.passed === true && !value.stale) return JSON.stringify({ status: 'completed', alreadyCompleted: true, reviewPassed: true, projectId: project.id, episodeId: episode.id })
          throw new Error('已有未通过或过期内容，请查询原因并按用户要求选择 modify 或 regenerate')
        }
      }
      if (args.stage === 'story' && (episode.summary.check.passed !== true || episode.summary.stale)) throw new Error('本集摘要尚未通过审核，不能生成剧情')
      let task
      try {
        task = tasks.start({ action, origin: 'session', projectId: project.id, episodeId: episode?.id, sessionId, mode: args.mode,
          generationMode: args.mode === 'modify' ? 'modify' : 'regenerate', requirements: args.requirements || '', review: args.mode === 'modify' ? args.review : '',
        }, exec.agent.session)
      } catch (error) {
        // 本集已被占用（面板或其他会话的操作排队中或执行中）：不报错，返回 busy，由会话等待该操作结束后重新发起。
        if (error.code !== 'EPISODE_BUSY') throw error
        return JSON.stringify({ status: 'busy', busy: true, operationId: error.busy.operationId, label: error.busy.label, initiator: error.busy.initiator, message: error.message, projectId: project.id, episodeNumber: args.episodeNumber })
      }
      return JSON.stringify({ operationId: task.id, status: 'running', projectId: project.id, episodeId: episode?.id, episodeNumber: args.episodeNumber })
    },
  }
}
