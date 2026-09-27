import { checkContext } from '../data/self-checks.js'
import { runTextGeneration } from '../workers/text-generation-worker.js'
import { node, cardModel } from '../../client/drama-model.js'
export { generateShots, reviseShot, generateShotSeconds, generateStoryboard, generateShotStoryboard } from './shot-text.js'
import { h3PromptText } from './film.js'
import { imageAssets, pictureRecord, usableLook } from './image.js'
import { parseJsonValue, textMaxTokens } from './chat.js'


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

function context(project) {
  const style = visualStyle(project)
  const lines = [
    `标题：${project.title}`,
    `总时长：${project.durationSeconds}s`,
    `画幅：${project.aspectRatio || '1344x768'}`,
    ...(style ? [`视觉风格：${style}`] : []),
    `本集摘要：${project.summary.content}`,
  ]
  if (project.projectSummary && project.projectSummary !== project.summary.content) lines.push(`项目摘要：${project.projectSummary}`)
  if (project.script) lines.push(`剧本：\n${project.script}`)
  return lines
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
    `项目摘要：${project.summary.content}`,
    `这一集是第 ${next} 集。`,
  ]
  if (next === 1) lines.push('第 1 集只根据项目摘要写本集剧情。')
  else {
    lines.push('承接上一集，不要重复已经演过的情节。')
    lines.push('已有剧集：')
    previous.forEach((episode, index) => {
      lines.push(`第 ${index + 1} 集（${episode.durationSeconds} 秒）：${episode.summary.content}`)
    })
  }
  if (project.script) lines.push(`项目剧本：${project.script}`)
  if (episodeId) {
    lines.push(`重新生成第 ${next} 集的摘要，不是续写下一集。${checkContext.getStore()?.generationMode === 'modify' ? `原摘要是修改基稿：${ordered[index].summary.content}` : '根据上游资料重新创作。'}`)
    lines.push(`本集已有时长 ${ordered[index].durationSeconds} 秒，摘要内容应适合这一时长。`)
    const following = ordered.slice(index + 1)
    if (following.length) {
      lines.push('后续剧集是衔接约束，不是已经发生的剧情；本集结尾应能接上后续开头：')
      following.forEach((episode, offset) => lines.push(`第 ${next + offset + 1} 集：${episode.summary.content}`))
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

export async function generateEpisode({ route, project, episodeId, signal, fetchImpl, request }) {
  const result = await runTextGeneration({
    skill: 'skill-gailan-episode-generate', instructions: episodePrompt(project, episodeId),
    options: { route, project: { ...project, durationSeconds: 180 }, signal, fetchImpl, request, maxTokens: 4096 },
    validate: text => normalizeEpisodeDraft(parseJsonValue(text)),
  })
  return { ...normalizeEpisodeDraft(parseJsonValue(result.text)), check: result.check }
}

export async function generateStoryPackage({ route, project, signal, fetchImpl }) {
  const previous = { outline: project.plot.outline.content, characters: project.plot.characters, scenes: project.plot.scenes }
  const prompt = [...context(project), `本集时长 ${project.durationSeconds} 秒，仅用于控制剧情容量；大纲不标制作秒数或镜头编号，具体计时由镜头表规划。一次返回 outline、characters.items、scenes.items；先规划大纲，再基于本次大纲完整建卡。人物和场景不要生成图片。`,
    ...(checkContext.getStore()?.generationMode === 'modify' ? [`已有资料（定向修改，未涉及内容保留）：${JSON.stringify(previous)}`] : [])].join('\n')
  const options = { route, project, signal, fetchImpl, maxTokens: textMaxTokens(project.durationSeconds) }
  const normalize = text => {
    const raw = parseJsonValue(text)
    return { outline: required(raw.outline, '大纲是空的'), characters: normalizeCharacters(raw.characters), scenes: normalizeScenes(raw.scenes) }
  }
  const generated = await runTextGeneration({ skill: 'skill-juqing-outline-generate', instructions: prompt, options, validate: normalize })
  return { ...normalize(generated.text), check: generated.check }
}

export async function regenerateCardGroup({ project, kind, route, review }) {
  const normalize = text => (kind === 'characters' ? normalizeCharacters : normalizeScenes)(parseJsonValue(text))
  const result = await runTextGeneration({
    skill: 'skill-juqing-outline-generate',
    instructions: [...context(project), `本次仅修订${kind === 'characters' ? '人物卡' : '场景卡'}集合，不生成或修改大纲与另一类卡片。输出仅为 {"items":[...]}，沿用该类卡片字段要求。`, `已通过大纲：${project.plot.outline.content}`, ...(checkContext.getStore()?.generationMode === 'modify' ? [`已有卡片：${JSON.stringify(project.plot[kind].items)}`] : []), `人工意见：${review || ''}`].join('\n'),
    options: { route, project }, validate: normalize,
  })
  return { ...normalize(result.text), check: result.check }
}
