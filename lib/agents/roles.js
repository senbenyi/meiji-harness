/** Professional ownership; role ids are persisted separately from worker leases. */
export const PRODUCTION_ROLES = {
  story: { name: '剧情', instruction: '负责原文事实、故事分析、世界观与关键事件。提取人物和场景事实，不设计分镜，不执行媒体生成。' },
  assets: { name: '角色', instruction: '从正式剧本提取角色、场景、道具与衍生状态，编写每项完整图片提示词。沿用稳定 id，标记剧本使用位置，不改变剧情。' },
  script: { name: '剧本', instruction: '负责分集规划、正式剧本、动作和对白。遵守故事设定，不编写镜头表，不执行媒体生成。' },
  storyboard: { name: '分镜', instruction: '依据已定镜头计划编写单帧图片提示词和分镜预览。保持构图、角色与资产状态，不重新拆镜或改写剧情。' },
  shot: { name: '镜头', instruction: '依据正式剧本与资产规划镜头顺序、时长和连续性，独立编写视频提示词。保持剧情、对白和精确资产状态；发现问题提出返工。' },
  delivery: { name: '成片', instruction: '负责按批准顺序组装镜头、核对完整性与交付要求。不遗漏或重排镜头；未观看或检查的媒体不能宣称质量通过。' },
}

export function productionRole(role) {
  const definition = PRODUCTION_ROLES[role]
  if (!definition) throw new Error(`unknown production subagent role: ${role}`)
  return definition
}

export function taskAgentRole(task) {
  if (task.kind === 'revise-text') return task.input?.kind === 'analysis' ? 'story' : 'script'
  return ({ 'render-reference': 'assets', 'render-storyboard': 'storyboard', 'render-shot': 'shot', 'concat-video': 'delivery', 'deliver-drama': 'delivery' })[task.kind] || task.input?.role || null
}
