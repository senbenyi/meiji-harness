import { node, cardModel } from './drama-model.js'
import { pictureRecord, usableLook } from './image-assets.js'
import { videoPromptText as h3PromptText } from './video-prompt-text.js'
import { episodeSummaryFailures, referenceDuration } from './episode-summary.js'
import { outlineFailures } from './story-outline.js'

export function required(value, message) {
  const text = String(value || '').trim()
  if (!text) throw Object.assign(new Error(message), { status: 400 })
  return text
}

const characterLookLabels = ['国籍：', '姓名：', '身份：', '性别：', '年代：', '年龄：', '服装：', '身高：', '体型：', '面相：']

function characterLookParts(look) {
  const english = ['nationality', 'name', 'role|identity', 'gender', 'era', 'age', 'costume|clothing', 'height', 'build|body type', 'features|face']
  const marks = characterLookLabels.map((label, i) => new RegExp(`(?:${label.slice(0, -1)}|\\b(?:${english[i]})\\b)\\s*[:：]`, 'i').exec(look))
  if (marks.some((mark, i) => !mark || (i > 0 && mark.index <= marks[i - 1].index))) return null
  const parts = {}
  const ready = marks.every((mark, i) => {
    const value = look.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? look.length).trim()
    parts[characterLookLabels[i].slice(0, -1)] = i === 8 ? value.replace(/\s*身型：/g, '，').replace(/，+/g, '，').replace(/^，|，$/g, '') : value
    return (value.match(/[\p{L}\p{N}]/gu) || []).length >= (i === 3 ? 1 : 2)
  })
  return ready ? parts : null
}

export function normalizeCharacters(raw) {
  const list = Array.isArray(raw?.items) ? raw.items : []
  if (!list.length) throw Object.assign(new Error('角色卡是空的'), { status: 502 })
  const items = list.map((item, index) => {
    const look = usableLook(item?.look)
    if (!look) throw Object.assign(new Error('角色画面提示词需要至少 12 个文字字符'), { status: 502 })
    const parts = characterLookParts(look)
    if (!parts) throw Object.assign(new Error('角色画面提示词要按顺序写明国籍、姓名、身份、性别、年代、年龄、服装、身高、体型和面相'), { status: 502 })
    return {
      ...libraryFields(item, 'characters'),
      id: `C${String(index + 1).padStart(2, '0')}`,
      name: required(item?.name || parts?.姓名, `角色 ${index + 1} 没有姓名`),
      type: 'role',
      nationality: required(item?.nationality || parts?.国籍 || '中国', `角色 ${index + 1} 没有国籍`),
      role: required(item?.role || parts?.身份, `角色 ${index + 1} 没有身份`),
      gender: required(item?.gender || parts?.性别, `角色 ${index + 1} 没有性别`),
      era: required(item?.era || parts?.年代, `角色 ${index + 1} 没有年代`),
      age: required(item?.age || parts?.年龄, `角色 ${index + 1} 没有年龄`),
      costume: required(item?.costume || parts?.服装, `角色 ${index + 1} 没有服装`),
      height: required(item?.height || parts?.身高, `角色 ${index + 1} 没有身高`),
      build: required([item?.build || parts?.体型, item?.build ? item?.figure : ''].map(value => String(value || '').trim()).filter((value, order, list) => value && list.indexOf(value) === order).join('，'), `角色 ${index + 1} 没有体型`),
      features: required(item?.features || parts?.面相, `角色 ${index + 1} 没有面相`),
      appearance: required(item?.appearance, `角色 ${index + 1} 没有外形`),
      prop: String(item?.prop || '').trim(),
      identity: required(item?.identity, `角色 ${index + 1} 没有身份锁定`),
      look,
      // 兼容旧项目快照；新输出协议不再生成或使用人物部位/造型素材。
      clothes: [],
      props: [],
      hairstyles: [],
      localPath: item?.localPath || null,
    }
  }).map(pictureRecord)
  return { ...node('characters'), items: items.map(cardModel) }
}

export function normalizeScenes(raw) {
  const list = Array.isArray(raw?.items) ? raw.items : []
  if (!list.length) throw Object.assign(new Error('场景卡是空的'), { status: 502 })
  const items = list.map((item, index) => ({
    ...libraryFields(item, 'scenes'),
    id: `E${String(index + 1).padStart(2, '0')}`,
    name: required(item?.name, `场景 ${index + 1} 没有名字`),
    type: 'scene',
    landmark: required(item?.landmark, `场景 ${index + 1} 没有固定地标`),
    light: required(item?.light, `场景 ${index + 1} 没有光位`),
    space: required(item?.space, `场景 ${index + 1} 没有空间说明`),
    look: usableLook(item?.look),
    localPath: null,
  }))
  if (items.some(item => !item.look)) throw Object.assign(new Error('场景画面提示词需要至少 12 个文字字符，且不能靠人物来描述'), { status: 502 })
  return { ...node('scenes'), items: items.map(cardModel) }
}

export function storyboardPromptText(item) {
  return h3PromptText(item.prompt)
}

// 时长固定为用户设定值；模型返回的时长字段一律忽略。
export function normalizeEpisodeDraft(raw, referenceDurationSeconds = 150) {
  const failures = episodeSummaryFailures(raw)
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { status: 502, code: 'INVALID_EPISODE_SUMMARY' })
  return { summary: raw.summary.trim(), durationSeconds: referenceDuration(referenceDurationSeconds) }
}

// 只检查格式，不依据词语猜测人物或环境的剧情语义。
export const outlineStructureFailures = outlineFailures

function libraryFields(item, kind) {
  const fields = { libraryId: String(item?.libraryId || '').trim() }
  if (kind !== 'characters') Object.assign(fields, { variantId: String(item?.variantId || '').trim(), variantLabel: String(item?.variantLabel || '').trim() })
  return fields
}
