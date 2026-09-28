import { projectStore } from '../server/data/projects.js'
import { linkStore } from '../server/data/links.js'
import { generationFeedback } from '../server/flow/tasks.js'

export const jsonOutput = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
export function sessionIdOf(exec) {
  const id = exec?.agent?.session?.id
  if (!id) throw new Error('需要从 Harness 会话调用')
  return id
}
export async function currentProject(home, exec) {
  const { projectId } = await linkStore(home).projectForSession(sessionIdOf(exec))
  if (!projectId) throw new Error('当前会话没有项目，请先创建或打开项目')
  return projectStore(home).read(projectId)
}
export function contextQueryTool({ home, tasks }) {
  return {
    name: 'meiji_context_query',
    description: '查询当前会话项目、按顺序排列的剧集及审核状态，以及可打开的项目。多步骤创作先查询，再使用 todo_write 规划业务步骤；内容必须通过生成工具保存。',
    parameters: { type: 'object', additionalProperties: false, properties: { episodeNumber: { type: 'integer', minimum: 1, description: '需要查看当前基稿时指定集数，返回该集完整数据；默认只返回概况' } } }, output: jsonOutput,
    async execute(args, exec) {
      const { projectId } = await linkStore(home).projectForSession(sessionIdOf(exec))
      const projects = await projectStore(home).list()
      const project = projects.find(item => item.id === projectId)
      const episode = args.episodeNumber ? [...(project?.episodes || [])].reverse()[args.episodeNumber - 1] : undefined
      if (args.episodeNumber !== undefined && (!Number.isInteger(args.episodeNumber) || !episode)) throw new Error('目标剧集不存在')
      return JSON.stringify({ ...(episode ? { episode } : {}), projects: projects.map(item => ({ id: item.id, title: item.title })), current: project ? {
        id: project.id, title: project.title, summary: project.summary.content,
        episodes: [...project.episodes].reverse().map((episode, index) => ({ id: episode.id, episodeNumber: index + 1, summary: episode.summary.content,
          stages: Object.fromEntries(['summary', 'outline', 'shots', 'seconds', 'storyboard'].map(stage => { const value = generationFeedback(episode, stage); return [stage, { status: value.status, passed: value.check.passed, failures: value.check.failures, stale: Boolean(value.stale) }] })) })),
        tasks: tasks.list(project.id),
      } : null })
    },
  }
}
