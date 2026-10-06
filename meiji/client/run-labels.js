import { element } from './panel-dom.js'
export const stepKindLabels = { execute: '执行', save: '保存', generate: '生成', review: '自审', revise: '修订', re_review: '复审', check: '内容校验', override: '人工放行',
  video_submit: '提交视频', video_generate: '生成视频', image_generate: '调用图片 API', image_download: '下载图片并转 Base64', image_base64: '转 Base64', image_save: '保存候选图片', tail_frame: '提取尾帧', assemble: '全片拼接', confirm: '处理候选图片', checkpoint: '人工关卡' }
const targetLabels = { 'project-summary': '项目摘要', summary: '摘要', story: '剧情', outline: '大纲', characters: '角色', scenes: '场景', props: '道具', shots: '镜头表', seconds: '每秒指令', storyboard: '文本提示词', film: '成片', assembly: '合成视频', image: '图片' }

export function targetLabel(target) {
  if (!target) return '本任务'
  const [kind, id, slot] = target.split(':')
  return [targetLabels[kind] || kind, id, slot].filter(Boolean).join(' · ')
}

// 文本步骤标题带上实际产物，避免任务详情里只看到无法区分的「生成 / 自审 / 修订」。
export function stepLabel(step) {
  const base = stepKindLabels[step?.kind] || step?.kind || '步骤'
  if (!['generate', 'review', 'revise', 're_review'].includes(step?.kind) || !step?.target) return base
  const [, ...identity] = targetLabel(step.target).split(' · ')
  const target = targetLabel(step.target).split(' · ')[0]
  return `${base}${target}${identity.length ? ` · ${identity.join(' · ')}` : ''}`
}

const skillNames = { episode: '剧集摘要', outline: '剧情整包', shots: '镜头表', 'shot-revise': '单镜修订', seconds: '每秒指令', storyboard: '文本分镜', video: '成片', 'image-prompt': '图片提示词改写', 'character-image': '人物参考图', 'scene-image': '场景参考图', 'part-image': '道具图片',
  'guidance-action': '动作指导', 'guidance-martial': '武术指导', 'guidance-dialogue': '台词指导', 'guidance-expression': '表情指导', 'guidance-sound': '声音指导' }

// 任务所用技能：任务开始时固定的组合，标明是否为修改后的基础版本、是否含本剧补充。
export function skillsLine(skills = []) {
  if (!skills.length) return null
  const text = skills.map(skill => {
    const notes = [skill.layers.includes('base') ? '基础已修改' : '', skill.layers.includes('node') ? '含本节点补充' : skill.layers.includes('project') ? '含本剧补充' : ''].filter(Boolean)
    return `${skillNames[skill.id] || skill.id}${skill.nodeKey ? ` · ${skill.nodeKey}` : ""}${notes.length ? `（${notes.join('、')}）` : ''}`
  }).join('、')
  const line = element('p', `所用技能：${text}`, 'meta task-skills')
  line.title = skills.map(skill => `${skill.id} ${skill.hash}`).join('\n')
  return line
}
