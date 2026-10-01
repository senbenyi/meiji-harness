import { checkContext } from '../data/operation-context.js'
import { buildTextPrompts } from './text-prompts.js'

function storyContext(project, modify) {
  const style = String(project?.style || '').trim()
  const lines = [
    `【项目配置】\n标题：${project.title}`,
    `总时长：${project.durationSeconds}s`,
    `画幅：${project.aspectRatio || '1344x768'}`,
    ...(style ? [`视觉风格：${style}`] : []),
  ]
  if (modify || checkContext.getStore()?.requestedMode === 'generate') lines.push(`【输入内容：本集摘要】\n${project.summary.content}`)
  if (project.episodeNumber) lines.push(`本次生成第 ${project.episodeNumber} 集。`)
  for (const [label, content] of [['前集结尾与已发生事实', project.previousEpisodeSummary], ['后集衔接约束，不提前演出', project.nextEpisodeSummary]]) {
    if (content) lines.push(`【上下文：${label}】\n${content}`)
  }
  if (project.projectSummary) lines.push(`【上下文：项目背景】\n项目摘要：${project.projectSummary}\n项目背景只帮助理解设定，不把后续事件提前写入本集。`)
  if (project.script) lines.push(`【输入内容：剧本资料】\n剧本：\n${project.script}`)
  return lines
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
  const instructions = `【任务模式】\n${modify ? '定向修改，保留未涉及内容。' : ctx?.requestedMode === 'generate' ? '首次生成，依据本集摘要展开剧情，不改变已确定的关键事件。' : '重新生成，仅使用项目背景、剧本、本集配置和跨集约束，不使用本集旧摘要、旧剧情或历史意见。'}\n${context}`
  return buildTextPrompts({ skill: 'outline', project, modify,
    instructions: instructions + (modify ? `\n【修改基稿】\n${JSON.stringify(previous)}` : ''),
    reviewInstructions: context,
    opinion: modify ? [...new Set([ctx?.review, review].filter(Boolean))].join('\n') : '',
  })
}
