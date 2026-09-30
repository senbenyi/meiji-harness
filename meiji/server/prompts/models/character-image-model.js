// 人物图提示词的数据结构与基础转换。调用方负责提供规则正文和画幅；本模块不读取文件或发送请求。
import { segment, render } from '../skill-prompts.js'
import { characterFieldValues } from '../../../shared/character-facts.js'

const characterFields = [
  ['nationality', '国籍'], ['name', '姓名'], ['role', '身份'],
  ['gender', '性别'], ['era', '年代'], ['age', '年龄'],
  ['height', '身高'], ['build', '体型'], ['features', '面相'],
]

/**
 * @typedef {object} CharacterImageFacts
 * @property {string} nationality 国籍
 * @property {string} name 姓名
 * @property {string} role 身份
 * @property {string} gender 性别
 * @property {string} era 年代
 * @property {string} age 年龄，保留原始描述
 * @property {string} height 身高，保留原始描述
 * @property {string} build 体型（含已有身型资料）
 * @property {string} features 面相与外观特征
 *
 * @typedef {object} CharacterImageModel
 * @property {CharacterImageFacts} character
 * @property {string} generationRules
 * @property {{width: number, height: number}} canvas
 * @property {'generate'|'reference'|'modify'} mode
 * @property {string} role 固定为人物角色设计师，不作为接口字段发送。
 * @property {Array<{purpose: 'edit-base'|'character-reference', base64: string}>} images 有序图片来源
 * @property {{instruction: string, preserveUnspecified: boolean}|null} modification
 */

/**
 * 创建可 JSON 序列化的人物图提示词 model。
 * @param {object} input
 * @param {object} input.character 人物资料；沿用 characterFieldValues 的字段与 look 解析。
 * @param {string} input.generationRules generate-character-image.md 的完整正文，可为空。
 * @param {{width: number, height: number}} input.canvas 自定义整数像素宽高，无默认画幅。
 * @returns {CharacterImageModel}
 */
function normalizeModel({ character, generationRules, canvas, mode = 'generate', images = [], modification = null } = {}) {
  if (!character || typeof character !== 'object' || Array.isArray(character)) {
    throw Object.assign(new Error('人物图提示词需要人物资料对象'), { status: 400 })
  }
  if (typeof generationRules !== 'string') {
    throw Object.assign(new Error('人物图生成规则必须是字符串正文'), { status: 400 })
  }
  if (!canvas || !Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
    throw Object.assign(new Error('人物图画幅宽高必须是正整数像素'), { status: 400 })
  }
  if (!['generate', 'reference', 'modify'].includes(mode)) throw Object.assign(new Error('人物图模式无效'), { status: 400 })
  if (!Array.isArray(images) || images.length > 10 || images.some(image => !['edit-base', 'character-reference'].includes(image?.purpose) || typeof image.base64 !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.base64))) {
    throw Object.assign(new Error('人物图需要有效的 Base64 图片字符串与用途，最多 10 张'), { status: 400 })
  }
  if (mode === 'generate' && images.length) throw Object.assign(new Error('纯文字生成不能带参考图片'), { status: 400 })
  if (mode === 'reference' && (!images.length || images.some(image => image.purpose !== 'character-reference'))) throw Object.assign(new Error('参考模式需要人物参考图'), { status: 400 })
  if (mode === 'modify' && (images[0]?.purpose !== 'edit-base' || images.slice(1).some(image => image.purpose === 'edit-base'))) throw Object.assign(new Error('修改模式需要第一张图片作为唯一原图'), { status: 400 })
  const instruction = String(modification?.instruction || '').trim()
  if (mode === 'modify' && !instruction) throw Object.assign(new Error('人物图修改需要输入意见'), { status: 400 })
  if (mode !== 'modify' && modification) throw Object.assign(new Error('修改意见仅用于修改模式'), { status: 400 })
  const values = characterFieldValues(character)
  return {
    character: Object.fromEntries(characterFields.map(([key]) => [key, values[key]])),
    generationRules,
    canvas: { width: canvas.width, height: canvas.height },
    mode,
    role: '人物角色设计师',
    images: images.map(image => ({ purpose: image.purpose, base64: image.base64 })),
    modification: mode === 'modify' ? { instruction, preserveUnspecified: modification?.preserveUnspecified !== false } : null,
  }
}

// 方法放在原型上，JSON 序列化仅包含数据；可用 createCharacterImageModel 恢复方法。
export class CharacterImageModel {
  constructor(input) { Object.assign(this, normalizeModel(input)) }
  toSegments() { return characterImageModelSegments(this) }
  toPrompt() { return render(this.toSegments()) }
}

export function createCharacterImageModel(input) { return new CharacterImageModel(input) }

export function characterImageModelSegments(model) {
  const normalized = normalizeModel(model)
  const { width, height } = normalized.canvas
  const orientation = width === height ? '正方形' : width > height ? '横幅' : '竖幅'
  const facts = characterFields.filter(([key]) => normalized.character[key])
    .map(([key, label]) => `${label}：${normalized.character[key]}`).join('\n')
  const task = normalized.mode === 'modify'
    ? '以输入图片1为原图，执行本次修改意见。'
    : normalized.mode === 'reference'
      ? '根据人物资料、参考图片与生成规则，生成一张人物参考图。'
      : '根据人物资料与生成规则，生成一张人物参考图。'
  const references = normalized.images.map((image, index) => `输入图片${index + 1}：${image.purpose === 'edit-base' ? '本次编辑原图，作为未修改内容的依据。' : '人物外观参考，参考人物特征，构图与背景按本次要求。'}`).join('\n')
  return [
    segment('context', '【角色与职责】', `你是一名${normalized.role}，负责保持人物身份与外观一致，并按本次要求设计或修改人物参考图。`),
    segment('context', '【任务】', task),
    segment('context', '【图片用途】', references),
    segment('context', '【人物资料】', facts),
    segment('constraint', '【生成规则】', normalized.generationRules, { skill: 'character-image', field: 'constraints' }),
    segment('context', '【画幅】', `${width} × ${height} 像素，${orientation}。按此画幅安排构图。`),
    segment('context', '【本次修改意见】', normalized.modification?.instruction || ''),
    segment('context', '【修改边界】', normalized.mode === 'modify' ? [
      '修改意见明确更改的属性，替代人物资料中该属性的原始描述；生成规则仍为本次成图要求。',
      normalized.modification.preserveUnspecified ? '保留原图中未被意见、生成规则与画幅要求涉及的人物特征、构图及其他内容。' : '',
    ].filter(Boolean).join('\n') : ''),
  ]
}

export function characterImageModelToPrompt(model) {
  return render(characterImageModelSegments(model))
}
