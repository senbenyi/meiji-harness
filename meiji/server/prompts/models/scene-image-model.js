// 场景图提示词的数据结构与基础转换。调用方负责提供规则正文和画幅；本模块不读取文件或发送请求。
import { segment, render } from '../skill-prompts.js'
import { requirementsText } from '../prompt-requirements.js'

const sceneFields = [
  ['name', '名称'], ['landmark', '地标'], ['light', '光位'], ['space', '空间'], ['look', '画面'],
]

/**
 * 可序列化场景图 model。scene 为最新场景卡五项资料；generationRules 为调用方读取的
 * generate-scene-image-skill.md 或已保存覆盖正文；additionalInstructions 为本剧补充。
 * canvas 为自定义正整数像素；mode 为 generate/reference/modify。
 * images 按提交顺序使用 { purpose: 'edit-base'|'scene-reference', base64: data URL }。
 * modification: { instruction, preserveUnspecified } 仅用于场景资料之外的画面修改。
 */
function normalizeModel({ scene, generationRules, canvas, additionalInstructions = '', mode = 'generate', images = [], modification = null } = {}) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
    throw Object.assign(new Error('场景图提示词需要场景资料对象'), { status: 400 })
  }
  if (typeof generationRules !== 'string') {
    throw Object.assign(new Error('场景图生成规则必须是字符串正文'), { status: 400 })
  }
  if (!canvas || !Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
    throw Object.assign(new Error('场景图画幅宽高必须是正整数像素'), { status: 400 })
  }
  if (!['generate', 'reference', 'modify'].includes(mode)) throw Object.assign(new Error('场景图模式无效'), { status: 400 })
  if (!Array.isArray(images) || images.length > 10 || images.some(image => !['edit-base', 'scene-reference'].includes(image?.purpose) || typeof image.base64 !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.base64))) {
    throw Object.assign(new Error('场景图需要有效的 Base64 图片字符串与用途，最多 10 张'), { status: 400 })
  }
  if (mode === 'generate' && images.length) throw Object.assign(new Error('纯文字生成不能带参考图片'), { status: 400 })
  if (mode === 'reference' && (!images.length || images.some(image => image.purpose !== 'scene-reference'))) throw Object.assign(new Error('参考模式需要场景参考图'), { status: 400 })
  if (mode === 'modify' && (images[0]?.purpose !== 'edit-base' || images.slice(1).some(image => image.purpose === 'edit-base'))) throw Object.assign(new Error('修改模式需要第一张图片作为唯一原图'), { status: 400 })
  const instruction = String(modification?.instruction || '').trim()
  if (mode === 'modify' && !instruction) throw Object.assign(new Error('场景图修改需要输入意见'), { status: 400 })
  if (mode !== 'modify' && modification) throw Object.assign(new Error('修改意见仅用于修改模式'), { status: 400 })
  if (typeof additionalInstructions !== 'string') throw Object.assign(new Error('场景图本剧补充必须是字符串'), { status: 400 })
  const values = Object.fromEntries(sceneFields.map(([key]) => [key, String(scene[key] || '').trim()]))
  return {
    scene: values,
    generationRules,
    additionalInstructions,
    canvas: { width: canvas.width, height: canvas.height },
    mode,
    role: '影视场景设计师',
    images: images.map(image => ({ purpose: image.purpose, base64: image.base64 })),
    modification: mode === 'modify' ? { instruction, preserveUnspecified: modification?.preserveUnspecified !== false } : null,
  }
}

// 方法放在原型上，JSON 序列化仅包含数据；可用 createSceneImageModel 恢复方法。
export class SceneImageModel {
  constructor(input) { Object.assign(this, normalizeModel(input)) }
  toSegments() { return sceneImageModelSegments(this) }
  toPrompt() { return render(this.toSegments()) }
}

export function createSceneImageModel(input) { return new SceneImageModel(input) }

export function sceneImageModelSegments(model) {
  const normalized = normalizeModel(model)
  const { width, height } = normalized.canvas
  const orientation = width === height ? '正方形' : width > height ? '横幅' : '竖幅'
  const facts = Object.fromEntries(sceneFields.filter(([key]) => normalized.scene[key])
    .map(([key]) => [key, normalized.scene[key]]))
  const task = normalized.mode === 'modify'
    ? '依据本次场景资料、原图和本次修改意见修订场景参考图，遵守基础规则和补充规则。'
    : normalized.mode === 'reference'
      ? '依据本次场景资料，结合参考图片生成一张场景参考图，遵守基础规则和补充规则。'
      : '依据本次场景资料生成一张场景参考图，遵守基础规则和补充规则。'
  const references = normalized.images.length ? { images: normalized.images.map((image, index) => ({ index: index + 1, purpose: image.purpose })) } : ''
  const rules = [normalized.generationRules, normalized.mode === 'reference'
    ? '参考图片仅提供空间与环境参考；地标、光位、空间布局与画面要求以本次场景资料为准。' : ''].filter(Boolean).join('\n\n')
  return [
    segment('context', '【角色与职责】', `你是一名${normalized.role}。`),
    segment('context', '【本次任务】', task),
    segment('context', '【本次要求】', requirementsText({ width, height, orientation })),
    segment('context', '【场景资料】', facts),
    segment('context', '【参考图片】', references),
    segment('context', '【本次修改意见】', normalized.modification?.instruction || ''),
    segment('stage', '【基础规则】', rules, { skill: 'scene-image', field: 'generate' }),
    segment('project', '【补充规则】', normalized.additionalInstructions, { skill: 'scene-image', field: 'generate' }),
    segment('context', '【本次修订范围】', normalized.mode === 'modify' ? [
      '始终按最新场景资料成图；原图与参考图不能覆盖最新资料。场景资料有变化时直接使用新资料，不从原图恢复旧资料。\n意见仅用于场景资料之外的画面调整；资料中的地标、光位、空间与画面要求以最新值为准。',
      normalized.modification.preserveUnspecified ? '在满足最新场景资料、基础规则、补充规则与画幅的前提下，保留原图中未被意见涉及的内容。' : '',
    ].filter(Boolean).join('\n') : ''),
    segment('protocol', '【本次输出协议】', '只输出一张图片，不输出解释或审核文字。'),
  ]
}

export function sceneImageModelToPrompt(model) {
  return render(sceneImageModelSegments(model))
}
