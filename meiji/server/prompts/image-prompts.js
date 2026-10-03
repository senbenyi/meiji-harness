import { join } from 'node:path'
import { render } from './skill-prompts.js'
import { imageSegments } from './interfaces/prompt-interfaces.js'

export function propImagePrompt(item, project, instruction = '') {
  return imageSkillPrompt('part-image', { id: item.id, name: item.name, category: item.category, description: item.description, evidence: item.evidence }, project, { instruction })
}

export function pencilPrompt(item) {
  if (item?.format === 'text' && item.prompt?.text) return `一张黑白铅笔分镜，按以下提示词的时间顺序绘制关键画面，格子均匀排列并标注时间码，人物与场景保持一致，不新增剧情。镜头 ${item.id}，${item.duration} 秒。\n${item.prompt.text}`
  const panels = Array.isArray(item?.panels) ? item.panels : []
  if (!panels.length) throw Object.assign(new Error('请先写好这一镜的文本分镜'), { status: 409 })
  const lines = [
    '一张黑白铅笔分镜，所有格子画在同一张图里。细铅笔线，留白，不要上色，不要画成真人照片。',
    `一共 ${panels.length} 格，每格一样大，按时间从左到右、从上到下排列，格子之间留出间距。`,
    `${item.id || ''}，${item.duration || panels.length} 秒，场景：${item.scene || ''}`,
  ]
  for (const panel of panels) {
    lines.push(`${panel.time}：${panel.pose}。镜头：${panel.camera}。位置：${panel.space || '沿用这一镜的空间'}`)
  }
  lines.push('每格左上角用很小的字标时间码。不要大标题，不要水印，不要字幕。整张图的每一格都要完整落在画面内。整张图使用灰白纯色背景。')
  return lines.join('\n')
}

// 图片接口只负责选取对应的独立组装模块；段落结构由该模块决定。
export function imageSkillPrompt(stage, prompt, project, options = {}) {
  return render(imageSegments({ ...options, stage, project, request: prompt }))
}
