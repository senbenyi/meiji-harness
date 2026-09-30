// 场景图提示词的数据结构与基础转换。调用方负责提供规则正文和画幅；本模块不读取文件或发送请求。
import { segment, render } from '../skill-prompts.js'

const sceneFields = [
  ['name', '名称'], ['landmark', '地标'], ['light', '光位'], ['space', '空间'], ['look', '画面'],
]

/**
 * 可序列化场景图 model。scene 为最新场景卡五项资料；generationRules 为调用方读取的
 * generate-scene-image.md 或已保存覆盖正文；additionalInstructions 为本剧补充。
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
    scene: Object.fromEntries(sceneFields.map(([key]) => [key, values[key]])),
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
  const facts = sceneFields.filter(([key]) => normalized.scene[key])
    .map(([key, label]) => `${label}：${normalized.scene[key]}`).join('\n')
  const task = normalized.mode === 'modify'
    ? '以输入图片1为原图，执行本次修改意见。'
    : normalized.mode === 'reference'
      ? '根据场景资料、参考图片与生成规则，生成一张场景参考图。'
      : '根据场景资料与生成规则，生成一张场景参考图。'
  const references = normalized.images.map((image, index) => `输入图片${index + 1}：${image.purpose === 'edit-base' ? '本次编辑原图，作为未修改内容的依据。' : '场景空间与环境参考，地标、光位和布局以最新场景资料为准。'}`).join('\n')
  return [
    segment('context', '【角色与职责】', `你是一名${normalized.role}，负责保持场景地标、空间布局与光位一致，并按本次要求设计或修改无人场景参考图。`),
    segment('context', '【任务】', task),
    segment('context', '【图片用途】', references),
    segment('context', '【场景资料】', facts),
    segment('context', '【资料边界】', '最新场景资料是事实依据。参考图与原图仅辅助成图，不覆盖资料；仅使用实际提供的信息。'),
    segment('constraint', '【生成规则】', normalized.generationRules, { skill: 'scene-image', field: 'generate' }),
    segment('project', '【本剧补充】', normalized.additionalInstructions, { skill: 'scene-image', field: 'generate' }),
    segment('context', '【画幅】', `${width} × ${height} 像素，${orientation}。按此画幅安排构图。`),
    segment('context', '【本次修改意见】', normalized.modification?.instruction || ''),
    segment('context', '【修改边界】', normalized.mode === 'modify' ? [
      '始终按最新场景资料成图；原图与参考图不能覆盖最新资料。场景资料有变化时直接使用新资料，不从原图恢复旧资料。\n意见仅用于场景资料之外的画面调整；资料中的地标、光位、空间与画面要求以最新值为准。',
      normalized.modification.preserveUnspecified ? '在满足最新场景资料、生成规则、本剧补充与画幅的前提下，保留原图中未被意见涉及的内容。' : '',
    ].filter(Boolean).join('\n') : ''),
  ]
}

export function sceneImageModelToPrompt(model) {
  return render(sceneImageModelSegments(model))
}
