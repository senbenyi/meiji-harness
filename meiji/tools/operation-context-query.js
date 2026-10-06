import { scriptFreshness, scriptBlockers, episodeHints, creativeDirection } from '../shared/script-assembly.js'
import { libraryDirectory } from '../shared/library-rules.js'
import { imageItems } from '../shared/library-images.js'
import { projectStore } from '../server/data/project-store.js'
import { linkStore } from '../server/data/workspace-links.js'
import { feedbackOf } from '../shared/review-feedback.js'

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
export function contextQueryTool({ home, runs }) {
  return {
    name: 'operation-context-query',
    description: '查询当前会话显式关联的项目、按顺序排列的剧集及审核状态，以及当前制作任务、暂停原因与可选动作；current 为 null 表示尚未关联，普通会话无需关联。制作通过 run-plan 预览目标。',
    parameters: { type: 'object', additionalProperties: false, properties: { episodeNumber: { type: 'integer', minimum: 1, description: '需要查看当前基稿时指定集数，返回该集完整数据；默认只返回概况' } } }, output: jsonOutput,
    async execute(args, exec) {
      const { projectId } = await linkStore(home).projectForSession(sessionIdOf(exec))
      const projects = await projectStore(home).list()
      const project = projects.find(item => item.id === projectId)
      const episode = args.episodeNumber ? [...(project?.episodes || [])].reverse()[args.episodeNumber - 1] : undefined
      if (args.episodeNumber !== undefined && (!Number.isInteger(args.episodeNumber) || !episode)) throw new Error('目标剧集不存在')
      return JSON.stringify({ ...(episode ? { episode } : {}), projects: projects.map(item => ({ id: item.id, title: item.title })), current: project ? {
        id: project.id, title: project.title, mode: project.mode, summary: project.summary.content, premise: creativeDirection(project),
        script: { kind: project.scriptKind, revision: project.scriptRevision, proposals: project.scriptProposals.filter(item => item.status === 'pending'), blockers: scriptBlockers(project), ...scriptFreshness(project) },
        library: Object.fromEntries(['characters', 'scenes', 'props'].map(kind => [kind, libraryDirectory(project, kind)])),
        images: { missing: project.episodes.flatMap(episode => imageItems(project, episode).filter(item => !item.ready).map(({ card, ...item }) => ({ ...item, episodeId: episode.id }))) },
        episodes: [...project.episodes].reverse().map((episode, index) => ({ id: episode.id, episodeNumber: index + 1, summary: episode.summary.content, hints: episodeHints(project, episode),
          stages: Object.fromEntries(['summary', 'outline', 'shots', 'seconds', 'storyboard'].map(stage => { const value = feedbackOf(episode, stage); return [stage, { status: value.status, passed: value.check.passed, failures: value.check.failures }] })) })),
        runs: runs ? await Promise.all((await runs.list(project.id, sessionIdOf(exec))).filter(run => ['draft', 'running', 'paused'].includes(run.status)).map(async run => { const detail = await runs.get(project.id, run.id, sessionIdOf(exec)); return { ...run, pause: detail.pause, prereq: detail.prereq, actions: [...new Set(detail.pause?.reasons.flatMap(reason => reason.actions) || [])] } })) : [],
      } : null })
    },
  }
}
