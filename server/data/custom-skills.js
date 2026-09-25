const stages = new Set(['outline', 'shots', 'seconds', 'storyboard', 'film'])
const skillStages = { 'meiji-outline': 'outline', 'meiji-shots': 'shots', 'meiji-revise-shot': 'shots', 'meiji-shot-seconds': 'seconds', 'meiji-storyboard': 'storyboard', 'meiji-film': 'film' }

export function customSkillPatch(project, stage, content) {
  if (!stages.has(stage) || typeof content !== 'string' || content.length > 20000) throw Object.assign(new Error('自定义 skill 阶段无效或内容超过 20000 字'), { status: 400 })
  const customSkills = { ...project.customSkills }
  if (content.trim()) customSkills[stage] = content.trim()
  else delete customSkills[stage]
  return { customSkills }
}

export function skillSupplement(project, skill) {
  const content = project?.customSkills?.[skillStages[skill]]
  return content ? `\n\n本阶段自定义 skill（补充内容要求，不改变输出结构、素材引用协议和项目语言配置）：\n${content}` : ''
}
