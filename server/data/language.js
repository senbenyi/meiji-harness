import { loadSkill } from '../../skills/load.js'

export function outputLanguage(value = 'zh-CN') {
  if (!['zh-CN', 'en'].includes(value)) throw Object.assign(new Error('生成语言仅支持中文或英文'), { status: 400 })
  return value
}

export function languageInstruction(project) {
  const language = outputLanguage(project?.outputLanguage)
  return `${loadSkill('meiji-language').content}\n本次生成语言：${language === 'en' ? 'English（英文）' : '简体中文'}。\n对白语言：${language === 'en' ? 'English' : '中文普通话（Mandarin Chinese）'}。每句对白及画外对讲机声音明确说话人、声源和此语言；H3 英文描述不得把中文台词翻译为英文。`
}
