import { runTextWorkflow } from '../flow/text-workflow.js'
import { buildStoryPrompts, buildEpisodePrompts } from '../prompts/story-prompts.js'
import { node, cardModel } from '../../client/drama-model.js'
export { generateShots, reviseShot, generateAllSeconds, generateShotSeconds, generateStoryboard, generateShotStoryboard } from './shot-text.js'
import { h3PromptText } from './film.js'
import { imageAssets, pictureRecord, usableLook } from './image.js'
import { parseJsonValue } from './chat.js'


function required(value, message) {
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
      clothes: imageAssets(item?.clothes),
      props: imageAssets(item?.props),
      hairstyles: imageAssets(item?.hairstyles),
      localPath: item?.localPath || null,
      imageUrl: item?.imageUrl || null,
      file: item?.file,
    }
  }).map(pictureRecord)
  return { ...node('characters'), items: items.map(cardModel) }
}

export function normalizeScenes(raw) {
  const list = Array.isArray(raw?.items) ? raw.items : []
  if (!list.length) throw Object.assign(new Error('场景卡是空的'), { status: 502 })
  const items = list.map((item, index) => ({
    id: `E${String(index + 1).padStart(2, '0')}`,
    name: required(item?.name, `场景 ${index + 1} 没有名字`),
    type: 'scene',
    landmark: required(item?.landmark, `场景 ${index + 1} 没有固定地标`),
    light: required(item?.light, `场景 ${index + 1} 没有光位`),
    space: required(item?.space, `场景 ${index + 1} 没有空间说明`),
    look: usableLook(item?.look),
    localPath: null,
    imageUrl: null,
  }))
  if (items.some(item => !item.look)) throw Object.assign(new Error('场景画面提示词需要至少 12 个文字字符，且不能靠人物来描述'), { status: 502 })
  return { ...node('scenes'), items: items.map(cardModel) }
}

export function storyboardPromptText(item) {
  return h3PromptText(item.prompt)
}

export function visualStyle(project) {
  return String(project?.style || '').trim()
}

export function normalizeEpisodeDraft(raw) {
  const summary = String(raw?.summary || '').trim()
  if (!summary || summary.length > 10000) throw Object.assign(new Error('本集剧情摘要为空或过长'), { status: 502 })
  const rawDuration = raw?.durationSeconds
  const durationSeconds = typeof rawDuration === 'string' && /^\d+$/.test(rawDuration.trim()) ? Number(rawDuration.trim()) : rawDuration
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 180) {
    throw Object.assign(new Error('本集时长需为 1–180 秒'), { status: 502 })
  }
  return { summary, durationSeconds }
}

export async function generateEpisode({ route, project, episodeId, signal, fetchImpl, request }) {
  const result = await runTextWorkflow({
    prompts: buildEpisodePrompts(project, episodeId),
    options: { route, project: { ...project, durationSeconds: 180 }, signal, fetchImpl, request },
    validate: text => normalizeEpisodeDraft(parseJsonValue(text)),
  })
  return { ...normalizeEpisodeDraft(parseJsonValue(result.text)), check: result.check }
}

export async function generateStoryPackage({ route, project, signal, fetchImpl, persist }) {
  const options = { route, project, signal, fetchImpl }
  const normalize = text => {
    const raw = parseJsonValue(text)
    return { outline: required(raw.outline, '大纲是空的'), characters: normalizeCharacters(raw.characters), scenes: normalizeScenes(raw.scenes) }
  }
  const generated = await runTextWorkflow({ prompts: buildStoryPrompts(project), options, validate: normalize, persist: persist && ((text, check) => persist({ ...normalize(text), check })) })
  return { ...normalize(generated.text), check: generated.check }
}

export async function regenerateCardGroup({ project, kind, route, review, persist, signal, fetchImpl, request }) {
  const normalize = text => (kind === 'characters' ? normalizeCharacters : normalizeScenes)(parseJsonValue(text))
  const result = await runTextWorkflow({
    prompts: buildStoryPrompts(project, kind, review),
    options: { route, project, signal, fetchImpl, request }, validate: normalize, persist: persist && ((text, check) => persist({ ...normalize(text), check })),
  })
  return { ...normalize(result.text), check: result.check }
}
