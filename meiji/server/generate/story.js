import { episodeSummaryFailures, referenceDuration } from '../../shared/episode-summary.js'
import { checkContext } from '../data/operation-context.js'
import { runTextSteps } from './text-steps.js'
import { buildStoryPrompts } from '../prompts/story-prompts.js'
import { buildEpisodePrompts } from '../prompts/episode-prompts.js'
import { node, cardModel } from '../../shared/drama-model.js'
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

export function normalizeEpisodeDraft(raw, referenceDurationSeconds = 150) {
  const failures = episodeSummaryFailures(raw, referenceDurationSeconds)
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { status: 502, code: 'INVALID_EPISODE_SUMMARY' })
  return { summary: raw.summary.trim(), durationSeconds: raw.durationSeconds }
}

export async function generateEpisode({ route, project, episodeId, referenceDurationSeconds, signal, fetchImpl, request, persist }) {
  const reference = referenceDuration(referenceDurationSeconds ?? project.episodes?.find(episode => episode.id === episodeId)?.durationSeconds)
  const result = await runTextSteps({
    target: 'summary',
    prompts: buildEpisodePrompts(project, episodeId, reference),
    options: { route, project: { ...project, durationSeconds: reference }, signal, fetchImpl, request },
    check: text => episodeSummaryFailures(parseJsonValue(text), reference),
    persist: persist && ((text, check) => persist({ ...normalizeEpisodeDraft(parseJsonValue(text), reference), check })),
  })
  return { ...normalizeEpisodeDraft(parseJsonValue(result.text), reference), check: result.check }
}

// 只检查格式，不依据词语猜测人物或环境的剧情语义。
export function outlineStructureFailures(text, language = 'zh-CN') {
  const headings = language === 'en' ? ['Motivation', 'World Rules', 'Causal Plot', 'Emotional Thread', 'Dialogue Beats', 'Ending State', 'Final Image']
    : ['主角动机', '世界规则', '因果剧情', '情绪线索', '对白节拍', '结尾状态', '结尾关键画面']
  const lines = String(text || '').split(/\r?\n/)
  let previous = -1
  const failures = []
  for (const title of headings) {
    const marker = `【${title}】`
    const index = lines.indexOf(marker)
    if (index <= previous || !lines[index + 1]?.trim() || /^【/.test(lines[index + 1])) failures.push(`大纲正文结构：${marker}须按顺序独占一行，下一行有正文`)
    previous = Math.max(previous, index)
  }
  return failures
}

// 三个独立文本流程：大纲通过后，按同一份最终大纲分别提取人物和场景。
export async function generateStoryPackage({ route, project, signal, fetchImpl, request, persist }) {
  const options = { route, project, signal, fetchImpl, request }
  const ctx = checkContext.getStore()
  const pending = () => ({ passed: null, failures: [] })
  const result = { outline: '', characters: { ...project.plot.characters, check: pending(), stale: true },
    scenes: { ...project.plot.scenes, check: pending(), stale: true }, checks: { outline: pending(), characters: pending(), scenes: pending() }, check: pending() }
  const save = async (kind, value, check, publish = true) => {
    if (kind === 'outline') result.outline = value
    else result[kind] = { ...value, check, stale: false }
    result.checks[kind] = check
    result.check = { passed: Object.values(result.checks).every(value => value.passed === true) ? true
      : Object.values(result.checks).some(value => value.passed === false) ? false : null,
      failures: Object.values(result.checks).flatMap(value => value.failures) }
    if (persist && publish) await persist({ ...result, phase: kind })
  }
  for (const kind of ['outline', 'characters', 'scenes']) {
    (signal || ctx?.signal)?.throwIfAborted()
    if (ctx) ctx.target = { ...ctx.originalOperation, action: 'outline', stageKey: kind }
    const input = kind === 'outline' ? project : { ...project, plot: { ...project.plot, outline: { ...project.plot.outline, content: result.outline } } }
    const normalize = text => {
      if (kind === 'outline') return required(text, '大纲是空的')
      const raw = parseJsonValue(text)
      if (Object.keys(raw).length !== 1 || !Array.isArray(raw.items)) throw new Error('提取结果仅允许 items 数组')
      return (kind === 'characters' ? normalizeCharacters : normalizeScenes)(raw)
    }
    const generated = await runTextSteps({ target: kind,
      prompts: buildStoryPrompts(input, kind, '', { extraction: kind !== 'outline' }), options,
      check: text => { normalize(text); return kind === 'outline' ? outlineStructureFailures(text, project.outputLanguage) : [] }, retainFailedDraft: kind === 'outline', persist: persist && ((text, check) => save(kind, normalize(text), check)) })
    await save(kind, normalize(generated.text), generated.check, false)
    if (!generated.check.passed) break
  }
  if (ctx) { ctx.target = ctx.originalOperation; ctx.validation = result.check.failures }
  return result
}

export async function regenerateCardGroup({ project, kind, route, review, persist, signal, fetchImpl, request }) {
  const normalize = text => (kind === 'characters' ? normalizeCharacters : normalizeScenes)(parseJsonValue(text))
  const result = await runTextSteps({
    target: kind,
    prompts: buildStoryPrompts(project, kind, review),
    options: { route, project, signal, fetchImpl, request }, check: text => { normalize(text); return [] }, persist: persist && ((text, check) => persist({ ...normalize(text), check })),
  })
  return { ...normalize(result.text), check: result.check }
}
