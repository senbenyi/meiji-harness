// 人物图接口负责技能快照、年龄规则与 Model 赋值；三种图片模式均由 Model 转换。
// 固定约束来自 skills/task/generate-character-image-skill.md。
// 图片上传、尺寸、请求发送和结果保存仍由生成/流程层负责。
import { characterFieldValues, characterSheet } from '../../../shared/character-facts.js'
import { currentSkillSet, recordUse } from '../skill-prompts.js'
import { builtinSkill } from '../../../skills/load-skills.js'

import { createCharacterImageModel } from '../../models/prompts/character-image-model.js'

const stage = 'character-image'
// 人物图只选这些外观资料；不带剧情服装、道具与卡片的面向指令。
export function characterStillPrompt(item) {
  return characterSheet(item).filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`).join('\n')
}

const hanDigit = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function hanYears(text) {
  const match = String(text || '').match(/([零一二两三四五六七八九十]+)\s*岁/)
  if (!match) return null
  const word = match[1]
  if (word === '十') return 10
  const ten = word.indexOf('十')
  if (ten < 0) return hanDigit[word] ?? null
  const high = ten === 0 ? 1 : hanDigit[word[ten - 1]]
  const low = word[ten + 1] ? hanDigit[word[ten + 1]] : 0
  if (high == null || low == null) return null
  return high * 10 + low
}

function statedAge(item) {
  const age = characterFieldValues(item).age
  const years = age.match(/(\d+)\s*(?:岁|周岁|years?\b)/i) || age.match(/^\s*(\d+)\s*$/)
  if (years) return Number(years[1])
  const han = hanYears(age)
  if (han != null) return han
  if (/童|幼|少儿|小孩|儿童|未成年|婴儿|孩童|少年|child|minor|teen|infant|toddler/i.test(age)) return 0
  return null
}

export function adultCharacter(item) {
  const years = statedAge(item)
  return years != null && years >= 18
}

// 约束正文只来自 skills/task/generate-character-image-skill.md。
// 普通正文原样使用；存在年龄条件时，实际人物只选适用条件，模板预览显示全文。
function selectConstraints(text, item) {
  if (!item) return text
  const parts = text.split(/^若为(成年人物|未成年或年龄不明)：\s*$/m)
  if (parts.length === 1) return text
  const selected = [parts[0]]
  const ageGroup = adultCharacter(item) ? '成年人物' : '未成年或年龄不明'
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] === ageGroup) selected.push(parts[i + 1])
  }
  return selected.map(value => value.trim()).filter(Boolean).join('\n\n')
}

// item 是实际人物卡；只有技能库模板预览/通用技能调用才可以只传 request。
function generate({ item, project, request = '', skillSet, ...options }) {
  const set = currentSkillSet(project, skillSet)
  recordUse(set, builtinSkill(stage), [])
  return characterImageGenerationModel(item, project, options, set).toSegments({ factsText: item ? undefined : request })
}

// 技能详情页没有选定人物的控件：有本集资料时预览第一张人物卡，否则展示模板占位。
function preview(args) {
  const item = args.project?.plot?.characters?.items?.find(entry => entry.type === 'role')
  return characterImage.generate({ ...args, item, request: '（人物资料将在生成时由所选人物卡提取；当前仅预览技能模板，具体年龄约束以人物卡为准）' })
}

export function characterImageGenerationModel(item, project, { canvas = { width: 768, height: 1344 }, images = [] } = {}, skillSet) {
  const set = currentSkillSet(project, skillSet)
  recordUse(set, builtinSkill(stage), [])
  return createCharacterImageModel({ mode: images.length ? 'reference' : 'generate', character: item || {},
    generationRules: selectConstraints(set.skills[stage].constraints ?? '', item), canvas, images })
}

export function characterImageModificationModel(item, project, { images, instruction, canvas }, skillSet) {
  const set = currentSkillSet(project, skillSet)
  recordUse(set, builtinSkill(stage), [])
  return createCharacterImageModel({
    mode: 'modify', character: item,
    generationRules: selectConstraints(set.skills[stage].constraints ?? '', item),
    canvas, images,
    modification: { instruction, preserveUnspecified: true },
  })
}

function modify({ item, project, skillSet, ...options }) {
  return characterImageModificationModel(item, project, options, skillSet).toSegments()
}

const characterImage = { generate, preview, modify }
export default characterImage

export function characterImagePrompt(item, project, skillSet, options = {}) {
  return characterImageGenerationModel(item || {}, project, options, skillSet).toPrompt()
}

export function characterImageModificationPrompt(item, project, options, skillSet) {
  return characterImageModificationModel(item, project, options, skillSet).toPrompt()
}
