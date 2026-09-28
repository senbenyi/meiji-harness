import { checkContext } from '../data/self-checks.js'
import { buildTextPrompts } from './text-prompts.js'

function storyContext(project, modify) {
  const style = String(project?.style || '').trim()
  const lines = [
    `【项目配置】\n标题：${project.title}`,
    `总时长：${project.durationSeconds}s`,
    `画幅：${project.aspectRatio || '1344x768'}`,
    ...(style ? [`视觉风格：${style}`] : []),
  ]
  if (modify) lines.push(`【修订依据：本集摘要】\n${project.summary.content}`)
  if (project.episodeNumber) lines.push(`本次生成第 ${project.episodeNumber} 集。`)
  for (const [label, content] of [['前集结尾与已发生事实', project.previousEpisodeSummary], ['后集衔接约束，不提前演出', project.nextEpisodeSummary]]) {
    if (content) lines.push(`【上下文：${label}】\n${content}`)
  }
  if (project.projectSummary) lines.push(`【上下文：项目背景】\n项目摘要：${project.projectSummary}\n项目背景只帮助理解设定，不把后续事件提前写入本集。`)
  if (project.script) lines.push(`【输入内容：剧本资料】\n剧本：\n${project.script}`)
  return lines
}

export function episodePrompt(project, episodeId) {
  const ordered = [...(project.episodes || [])].reverse()
  const index = episodeId ? ordered.findIndex(episode => episode.id === episodeId) : ordered.length
  if (index < 0) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  const previous = ordered.slice(0, index)
  const next = index + 1
  const lines = [
    `标题：${project.title}`,
    `画幅：${project.aspectRatio || '1344x768'}`,
    ...(String(project?.style || '').trim() ? [`视觉风格：${String(project?.style || '').trim()}`] : []),
    `【输入内容：视频总摘要】\n项目摘要：${project.summary.content}`,
    `这一集是第 ${next} 集。`,
  ]
  if (next === 1) lines.push('第 1 集根据项目摘要和已给剧本展开开场，同时遵守后集衔接约束。')
  else {
    lines.push('承接上一集结尾，继承此前已经确定的人物身份、位置、关系、关键物件和未解决矛盾；保持事件因果与时间顺序，不重复已发生的情节，不无故重置人物状态。视频总摘要规定整体故事方向，之前剧集摘要是已发生事实。')
    lines.push('【上下文：之前全部剧集摘要，按剧情顺序】')
    previous.forEach((episode, index) => {
      lines.push(`第 ${index + 1} 集（${episode.durationSeconds} 秒）：${episode.summary.content}`)
    })
  }
  if (project.script) lines.push(`项目剧本：${project.script}`)
  if (episodeId) {
    lines.push(`本次目标是第 ${next} 集的摘要，不是续写下一集。`)
    lines.push(`本集已有时长 ${ordered[index].durationSeconds} 秒，摘要内容应适合这一时长。`)
    const following = ordered.slice(index + 1)
    if (following.length) {
      lines.push('后续剧集是衔接约束，不是已经发生的剧情；本集结尾应能接上后续开头：')
      following.forEach((episode, offset) => lines.push(`第 ${next + offset + 1} 集：${episode.summary.content}`))
    }
  }
  lines.push('只返回 JSON。durationSeconds 不得超过 180。')
  return lines.join('\n')
}

export function buildStoryPrompts(project, kind = 'package', review = '') {
  const ctx = checkContext.getStore()
  const modify = ctx?.generationMode === 'modify'
  const original = ctx?.originalProject || project
  const previous = kind === 'package' ? { outline: original.plot.outline.content, characters: original.plot.characters, scenes: original.plot.scenes } : original.plot[kind].items
  const target = kind === 'package'
    ? `本集时长 ${project.durationSeconds} 秒，仅用于控制剧情容量；大纲不标制作秒数或镜头编号，具体计时由镜头表规划。一次返回 outline、characters.items、scenes.items；先规划大纲，再基于本次大纲完整建卡。人物和场景不要生成图片。`
    : `本次仅修订${kind === 'characters' ? '人物卡' : '场景卡'}集合，不生成或修改大纲与另一类卡片。输出仅为 {"items":[...]}，沿用该类卡片字段要求。\n已通过大纲：${project.plot.outline.content}`
  const context = `【本次目标】\n${target}\n${storyContext(project, modify).join('\n')}`
  const instructions = `【任务模式】\n${modify ? '定向修改，保留未涉及内容。' : '重新生成，仅使用项目背景、剧本、本集配置和跨集约束，不使用本集旧摘要、旧剧情或历史意见。'}\n${context}`
  return buildTextPrompts({ skill: 'skill-juqing-outline-generate', project,
    instructions: instructions + (modify ? `\n【修改基稿】\n${JSON.stringify(previous)}` : ''),
    reviewInstructions: context,
    opinion: modify ? [...new Set([ctx?.review, review].filter(Boolean))].join('\n') : '',
  })
}

const episodeRevisionRules = `【摘要修订边界】
以本次提供的基稿为唯一修改基准，按自审或人工意见定向修订。未涉及的事件、顺序、人物、对白和结尾保持原样，只修复必要的因果与衔接，不顺便扩写、删减或润色。返回完整 summary 和 durationSeconds，不返回补丁或修改说明。`

export function buildEpisodePrompts(project, episodeId) {
  const ctx = checkContext.getStore()
  const modify = ctx?.generationMode === 'modify'
  const context = episodePrompt(project, episodeId)
  const original = modify ? project.episodes.find(episode => episode.id === episodeId) : null
  if (modify && !original) throw new Error('修订摘要需要指定已有剧集')
  const mode = modify ? '按意见定向修订' : episodeId ? '重新生成，不使用本集旧摘要和历史意见' : '首次生成'
  return buildTextPrompts({ skill: 'skill-gailan-episode-generate', project,
    instructions: `【任务模式】\n${mode}\n${context}` + (modify ? `\n【修改基稿】\n${JSON.stringify({ summary: original.summary.content, durationSeconds: original.durationSeconds })}` : ''),
    reviewInstructions: context,
    opinion: modify ? ctx.review || '' : '',
    systemRules: modify ? episodeRevisionRules : '',
    revisionRules: episodeRevisionRules,
  })
}
