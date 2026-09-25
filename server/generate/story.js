export { generateShots, reviseShot, generateShotSeconds, generateStoryboard, generateShotStoryboard } from './shot-text.js'
import { h3PromptText } from './film.js'
import { imageAssets, pictureRecord, usableLook } from './image.js'
import { askSkill, parseJsonValue, textMaxTokens } from './chat.js'

import { skillSupplement } from '../data/custom-skills.js'
import { checkContext } from '../data/self-checks.js'

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
  return { items }
}

export function normalizeScenes(raw) {
  const list = Array.isArray(raw?.items) ? raw.items : []
  if (!list.length) throw Object.assign(new Error('场景卡是空的'), { status: 502 })
  if (list.length > 2) throw Object.assign(new Error('场景卡最多两张，只保留重要场景'), { status: 502 })
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
  return { items }
}

export function storyboardPromptText(item) {
  return h3PromptText(item.prompt)
}

export function visualStyle(project) {
  return String(project?.style || project?.brief?.style || '').trim()
}

function context(project) {
  const style = visualStyle(project)
  const lines = [
    `标题：${project.title}`,
    `总时长：${project.durationSeconds}s`,
    `画幅：${project.aspectRatio || '1344x768'}`,
    ...(style ? [`视觉风格：${style}`] : []),
    `本集摘要：${project.summary}`,
  ]
  if (project.projectSummary && project.projectSummary !== project.summary) lines.push(`项目摘要：${project.projectSummary}`)
  if (project.script) lines.push(`剧本：\n${project.script}`)
  return lines
}

async function ask(skillName, prompt, { route, project, signal, maxTokens }) {
  const text = await askSkill(skillName, prompt, {
    route, project, signal,
    maxTokens: maxTokens || textMaxTokens(project.durationSeconds),
  })
  if (skillName === 'meiji-characters') {
    const generated = parseJsonValue(text)
    const checked = parseJsonValue(await askSkill('meiji-content-review', JSON.stringify({ stage: skillName, instructions: prompt + skillSupplement(project, skillName), generated }), { route, project, signal, maxTokens: 4096, includeReview: false }))
    if (typeof checked.passed !== 'boolean' || !Array.isArray(checked.failures) || checked.failures.some(reason => typeof reason !== 'string') || checked.passed !== (checked.failures.length === 0)) throw Object.assign(new Error('内容自检返回格式不完整'), { status: 502, code: 'INVALID_MODEL_CHECK' })
    const context = checkContext.getStore()
    if (context) context.validation = checked.failures
  }
  return text
}

export function episodePrompt(project, episodeId) {
  const ordered = [...(project.episodes || [])].reverse()
  const index = episodeId ? ordered.findIndex(episode => episode.id === episodeId) : ordered.length
  if (index < 0) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  const previous = ordered.slice(0, index)
  const next = index + 1
  const lines = [
    `标题：${project.title}`,
    `画幅：${project.aspectRatio || '1344x768'}`,
    ...(visualStyle(project) ? [`视觉风格：${visualStyle(project)}`] : []),
    `项目摘要：${project.summary}`,
    `这一集是第 ${next} 集。`,
  ]
  if (next === 1) lines.push('第 1 集只根据项目摘要写本集剧情。')
  else {
    lines.push('承接上一集，不要重复已经演过的情节。')
    lines.push('已有剧集：')
    previous.forEach((episode, index) => {
      lines.push(`第 ${index + 1} 集（${episode.durationSeconds} 秒）：${episode.summary}`)
    })
  }
  if (project.script) lines.push(`项目剧本：${project.script}`)
  if (episodeId) {
    lines.push(`重新生成第 ${next} 集的摘要，不是续写下一集。原摘要供参考，不要照抄：${ordered[index].summary}`)
    lines.push(`本集已有时长 ${ordered[index].durationSeconds} 秒，摘要内容应适合这一时长。`)
    const following = ordered.slice(index + 1)
    if (following.length) {
      lines.push('后续剧集是衔接约束，不是已经发生的剧情；本集结尾应能接上后续开头：')
      following.forEach((episode, offset) => lines.push(`第 ${next + offset + 1} 集：${episode.summary}`))
    }
  }
  lines.push('只返回 JSON。durationSeconds 不得超过 180。')
  return lines.join('\n')
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

export async function generateEpisode({ route, project, episodeId, signal }) {
  const text = await ask('meiji-episode', episodePrompt(project, episodeId), { route, project: { ...project, durationSeconds: 180 }, signal, maxTokens: 4096 })
  return normalizeEpisodeDraft(parseJsonValue(text))
}

export function outlineDurationError(outline, durationSeconds) {
  const marks = [...String(outline || '').matchAll(/[（(]\s*(\d+)\s*(?:秒|s|secs?|seconds?)\s*[）)]/gi)].map(item => Number(item[1]))
  if (!marks.length) return '大纲没有写出每段秒数'
  const total = marks.reduce((sum, value) => sum + value, 0)
  const target = Number(durationSeconds)
  if (Math.abs(total - target) > 10) return `大纲各段共 ${total} 秒，与本集 ${target} 秒相差超过 10 秒`
  return ''
}

export async function generateOutline({ route, project, signal }) {
  const source = project.brief ? ['已通过的简报：', JSON.stringify(project.brief)] : ['以本集摘要为事实来源。']
  const prompt = [...context(project), '', ...source, '', `本集时长 ${project.durationSeconds} 秒。每段开头写「（N秒）」，各段相加后与这个时长相差不超过 10 秒。只写大纲正文，不要 JSON，不要景别和运镜。`].join('\n')
  const outline = await ask('meiji-outline', prompt, { route, project, signal })
  if (!outline.trim()) throw Object.assign(new Error('大纲是空的'), { status: 502 })
  const mismatch = outlineDurationError(outline, project.durationSeconds)
  if (mismatch) throw Object.assign(new Error(mismatch), { status: 502 })
  return outline.trim()
}

export async function generateCharacters({ route, project, signal }) {
  const prompt = [...context(project), '', '已通过的大纲：', project.outline, '', '逐段分析本集所有出镜人物，按角色卡 skill 的正脸辨识或剧情影响条件完整建卡，不以戏份少、无姓名或群演身份省略关键人物。姓名或稳定身份称谓写在 name，也写进 look 的姓名行。只返回 JSON。'].join('\n')
  return normalizeCharacters(parseJsonValue(await ask('meiji-characters', prompt, { route, project, signal })))
}

export async function generateScenes({ route, project, signal }) {
  const prompt = [...context(project), '', '已通过的大纲：', project.outline, '', '已锁定的角色名：', project.characters.items.map(item => item.name).join('、'), '', '最多两张场景卡，只写本集最重要的场景。次要地点并进去，不要另开。只返回 JSON。场景里不要出现人。'].join('\n')
  return normalizeScenes(parseJsonValue(await ask('meiji-scenes', prompt, { route, project, signal })))
}


function shotProgress(items) {
  return items.map((item, index) => {
    const last = Array.isArray(item.seconds) ? item.seconds[item.seconds.length - 1] : null
    return `S${String(index + 1).padStart(2, '0')} ${item.duration}s ${item.hook} 结尾：${last?.handoff || item.continuity || ''}`
  }).join('\n')
}
