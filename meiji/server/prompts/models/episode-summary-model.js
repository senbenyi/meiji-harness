// 摘要 model 只组织数据与提示词，不读取配置、不发请求。
import { segment, render } from '../skill-prompts.js'
import { referenceDuration, durationRange } from '../../../shared/episode-summary.js'

export class EpisodeSummaryModel {
  constructor({ project = {}, episodeId, referenceDurationSeconds, generationRules = '', mode = 'generate', opinion = '' }) {
    const target = project.episodes?.find(episode => episode.id === episodeId)
    const ordered = [...(project.episodes || [])].reverse()
    const index = episodeId ? ordered.findIndex(episode => episode.id === episodeId) : ordered.length
    if (index < 0) throw Object.assign(new Error('这一集不存在'), { status: 404 })
    const reference = referenceDuration(referenceDurationSeconds ?? target?.durationSeconds)
    const range = durationRange(reference)
    this.role = '短剧分集编剧'
    this.project = { title: project.title || '', summary: project.summary?.content || '', script: project.script || '',
      style: project.style || '', aspectRatio: project.aspectRatio || '1344x768', outputLanguage: project.outputLanguage || 'zh-CN' }
    this.target = { episodeId: episodeId || null, episodeNumber: index + 1, referenceDurationSeconds: reference,
      minDurationSeconds: range.min, maxDurationSeconds: range.max }
    const fact = (episode, position) => ({ episodeId: episode.id, episodeNumber: position + 1, durationSeconds: episode.durationSeconds, summary: episode.summary.content })
    this.previousEpisodes = ordered.slice(0, index).map(fact)
    this.followingEpisodes = ordered.slice(index + 1).map((episode, offset) => fact(episode, index + 1 + offset))
    this.summaryLength = { min: 1, max: 300 }
    this.generationRules = generationRules
    this.mode = mode
    this.modification = mode === 'modify' && target ? { baseSummary: target.summary.content, durationSeconds: target.durationSeconds, instruction: opinion } : null
    if (mode === 'modify' && !this.modification) throw new Error('修订摘要需要指定已有剧集')
  }
  contextText() {
    const { referenceDurationSeconds: reference, minDurationSeconds: min, maxDurationSeconds: max } = this.target
    return `${episodeContext(this)}\n参考时长：${reference} 秒。由 AI 按剧情容量决定实际时长，必须在 ${min}–${max} 秒内；摘要非空且最多 300 字（不计空白，标点计入）。`
  }
  // 接口选择技能、审核/修订与协议片段；model 统一返回角色分离的请求。
  toSegments({ system = [], user = [segment('context', '【任务与上下文】', this.contextText())], json = true } = {}) {
    return { json, system: [segment('context', '【角色与职责】', `你是一名${this.role}，负责本集事件链、因果与跨集衔接。`),
      segment('constraints', '【摘要固定约束】', this.generationRules, { skill: 'episode', field: 'constraints' }), ...system], user }
  }
  toMessages(parts) {
    const { system, user } = this.toSegments(parts)
    return [{ role: 'system', content: render(system) }, { role: 'user', content: render(user) }]
  }

}

function episodeContext({ project, target, previousEpisodes, followingEpisodes }) {
  const next = target.episodeNumber
  const lines = [
    `标题：${project.title}`, `画幅：${project.aspectRatio}`,
    ...(project.style ? [`视觉风格：${project.style}`] : []),
    `【输入内容：视频总摘要】\n项目摘要：${project.summary}`,
    `这一集是第 ${next} 集。`,
  ]
  if (previousEpisodes.length) {
    lines.push('【上下文：之前全部剧集摘要，按剧情顺序】')
    previousEpisodes.forEach(episode => lines.push(`第 ${episode.episodeNumber} 集（${episode.durationSeconds} 秒）：${episode.summary}`))
  }
  if (project.script) lines.push(`项目剧本：${project.script}`)
  if (target.episodeId) lines.push(`本次目标是第 ${next} 集的摘要，不是续写下一集。`)
  if (followingEpisodes.length) {
    lines.push('后续剧集是衔接约束，不是已经发生的剧情；本集结尾应能接上后续开头：')
    followingEpisodes.forEach(episode => lines.push(`第 ${episode.episodeNumber} 集：${episode.summary}`))
  }
  return lines.join('\n')
}
