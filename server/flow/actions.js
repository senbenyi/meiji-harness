import { skillSupplement } from '../data/custom-skills.js'
import { hasFilm, hasStoryboard } from '../../client/flow-rules.js'
import { clearShotDownstream } from './gates.js'
import { feedbackKey, feedbackOf } from '../../client/feedback.js'
import { checkContext, prepareChecks, selectCheck, setCheck } from '../data/self-checks.js'
import { shotSecondsReady } from '../../client/shot-timing.js'
import { readPicture, savePicture, pictureReference, readImageDraft, pictureTargetSnapshot } from '../data/pictures.js'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assetStore } from '../data/library.js'
import { canGenerate, hasCharacters, hasScenes, hasShots, staleMedia, aspectRatioOf } from './gates.js'
import { bindReferencePrompt, filmClipUrl, saveLastFrame, shotReferenceImages, submitH3, retrieveFilm, videoRequestMode, wantsOpeningFrame } from '../generate/film.js'
import { concatFilms } from '../generate/concat.js'
import { generateCharacters, generateEpisode, generateOutline, generateScenes, generateShotSeconds, generateShotStoryboard, generateShots, generateStoryboard, reviseShot, storyboardPromptText } from '../generate/story.js'
import { imageSkillPrompt, appendImageAsset, characterStillPrompt, clearCharacterImage, generateStillFile, imageSeed, importAssetImage, nextPartId, partPrompt, partSlots, pencilPrompt, pictureRecord, sceneStillPrompt, submitAssetImage, submitPencilBoard, usableLook } from '../generate/image.js'
import { askSkill } from '../generate/chat.js'
import { skillFilePath } from '../../skills/load.js'
import { normalizeModels } from '../../models/router.js'
import { projectStore, revisionStore } from '../data/projects.js'
import { modelStore } from '../data/models.js'
import { linkStore } from '../data/links.js'
import { addEpisode, editEpisode, materialize, normalizeProject, overviewPatch, scopeProjects, writeEpisodeCover } from '../data/episodes.js'
import { insertSessionLog } from './session-log.js'
import { decodeImageData } from '../generate/character-views.js'
import { uploadGatewayFile } from '../generate/gateway.js'

const pending = new Map()

async function loadModels(models) {
  return normalizeModels(await models.read())
}
const actions = new Set(['create', 'open', 'overview', 'episode-add', 'episode-edit', 'episode-generate', 'source', 'outline-text', 'shot-assets', 'outline', 'characters', 'scenes', 'shots', 'seconds', 'revise-shot', 'shot-seconds', 'shot-storyboard', 'shot-boards', 'storyboard', 'pencil', 'image', 'revise-image', 'import-image', 'clear-image', 'use-asset', 'part-image', 'part-import', 'film', 'films', 'assemble', 'library-import'])
const episodeScoped = new Set(['confirm-image', 'discard-image', 'source', 'outline-text', 'shot-assets', 'outline', 'characters', 'scenes', 'shots', 'seconds', 'revise-shot', 'shot-seconds', 'shot-storyboard', 'shot-boards', 'storyboard', 'pencil', 'image', 'revise-image', 'import-image', 'clear-image', 'use-asset', 'part-image', 'part-import', 'film', 'films', 'assemble'])
const labels = {
  create: '创建项目',
  open: '打开项目',
  overview: '保存项目概要',
  'episode-add': '新增剧集',
  'episode-edit': '编辑剧集',
  'episode-generate': '生成本集剧情',
  source: '修改原始资料',
  'outline-text': '修改大纲',
  outline: '写故事大纲',
  characters: '写角色卡',
  scenes: '写场景卡',
  shots: '写镜头表',
  seconds: '生成每秒指令',
  'revise-shot': '按审核意见重写镜头',
  'shot-seconds': '生成每秒指令',
  'shot-storyboard': '生成这一镜的分镜',
  'shot-boards': '生成所有分镜',
  pencil: '生成铅笔分镜',
  storyboard: '生成全部分镜表',
  image: '生成图片',
  'revise-image': '按新需求重绘图片',
  'import-image': '导入图片',
  'clear-image': '删除图片',
  'part-image': '生成图片',
  'part-import': '导入图片',
  film: '提交成片',
  films: '一键成片',
  assemble: '全片拼接',
  'library-import': '导入素材',
  'use-asset': '关联图片素材',
}

export function stageOperation(input) {
  if (!actions.has(input?.action)) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  const id = randomUUID()
  pending.set(id, { ...input, id })
  return id
}

export function dropOperation(id) {
  pending.delete(String(id || ''))
}

export function takeOperation(id, sessionId, action) {
  const key = String(id || '')
  const operation = pending.get(key)
  if (!operation) throw Object.assign(new Error('这次操作已失效，请从右侧面板重新发起'), { status: 404 })
  if (sessionId !== undefined && operation.sessionId !== sessionId) throw Object.assign(new Error('操作不属于当前会话'), { status: 403 })
  if (action && operation.action !== action) throw Object.assign(new Error('操作与工具不匹配'), { status: 409 })
  pending.delete(key)
  return operation
}

export function takePendingForSession(sessionId) {
  if ([...pending.values()].some(item => item.sessionId === sessionId)) {
    throw Object.assign(new Error('面板操作必须携带消息中的 operationId'), { status: 409 })
  }
  return null
}

function callSite(file, fn) {
  return [`文件：${file}`, `函数：${fn}`]
}

export function describeOperation(operation) {
  const lines = [`【极乐世界】${labels[operation.action] || operation.action}`]
  if (operation.id) lines.push(`operationId: ${operation.id}`)
  if (operation.action === 'episode-generate') {
    if (operation.episodeId) lines.push('重新生成指定剧集摘要，保留剧集 ID 和时长；更新后该集下游内容需重新生成。')
    lines.push(...callSite(skillFilePath('meiji-episode'), 'generateEpisode（server/generate/story.js）'))
    lines.push('工具：meiji_episode（tools/tool-episode.js 的 execute）')
    lines.push('调用 meiji_episode 执行，必须传入上面的 operationId。不要改写正文，不要自动再生成下一集。')
    return lines.join('\n')
  }
  if (operation.action === 'revise-shot') {
    lines.push(`镜头 ${operation.track || ''}`)
    lines.push(`审核意见：${String(operation.review || '').trim()}`)
    lines.push(...callSite('server/generate/story.js', 'reviseShot'))
  } else if (operation.action === 'shot-seconds') {
    lines.push(`镜头 ${operation.track || ''}`)
    if (String(operation.review || '').trim()) lines.push(`审核意见：${String(operation.review).trim()}`)
    lines.push(...callSite(skillFilePath('meiji-shot-seconds'), 'generateShotSeconds（server/generate/story.js）'))
  } else if (operation.action === 'shot-storyboard') {
    lines.push(`镜头 ${operation.track || ''}`)
    if (String(operation.review || '').trim()) lines.push(`审核意见：${String(operation.review).trim()}`)
    lines.push(...callSite(skillFilePath('meiji-storyboard'), 'generateShotStoryboard（server/generate/story.js）'))
  } else if (operation.action === 'storyboard') {
    lines.push('一次生成全部分镜表。缺每秒指令的镜头先写满每一秒，再写分镜。不要要求用户先单独补每秒指令。')
    lines.push(...callSite(skillFilePath('meiji-shot-seconds'), 'generateShotSeconds（server/generate/story.js）'))
    lines.push(...callSite(skillFilePath('meiji-storyboard'), 'generateStoryboard（server/generate/story.js）'))
  } else if (operation.action === 'shot-boards') {
    lines.push('按镜头顺序，逐镜调用每秒指令和文本分镜')
    lines.push(...callSite(skillFilePath('meiji-shot-seconds'), 'generateShotSeconds（server/generate/story.js）'))
    lines.push(...callSite(skillFilePath('meiji-storyboard'), 'generateShotStoryboard（server/generate/story.js）'))
  } else if (operation.action === 'films') {
    lines.push('按镜头顺序，逐镜提交成片')
    lines.push(...callSite(skillFilePath('meiji-film'), 'videoRequestMode（server/generate/film.js）'))
    lines.push(...callSite('server/generate/film.js', 'submitH3'))
  } else if (operation.action === 'assemble') {
    lines.push('按镜头顺序用 FFmpeg 拼接成片')
    lines.push(...callSite('server/generate/concat.js', 'concatFilms'))
  } else if (operation.action === 'pencil') {
    lines.push(`镜头 ${operation.track || ''}`)
    if (String(operation.review || '').trim()) lines.push(`审核意见：${String(operation.review).trim()}`)
    lines.push(...callSite('server/generate/image.js', 'submitPencilBoard'))
    lines.push('一张图里画出这一镜的全部格子，每秒一格')
  } else if (operation.action === 'seconds') {
    lines.push('按镜头顺序写每一镜的每秒指令。不要改镜头表，不要写文本分镜。')
    lines.push(...callSite(skillFilePath('meiji-shot-seconds'), 'generateShotSeconds（server/generate/story.js）'))
  } else if (operation.action === 'shots') {
    const review = String(operation.review || '').trim()
    if (review) lines.push(`审核意见：${review}`)
    if (review) lines.push('按这条意见重写整张镜头表')
    lines.push(...callSite(skillFilePath('meiji-shots'), 'generateShots（server/generate/story.js）'))
  } else if (operation.track) lines.push(`轨道 ${operation.track}`)
  if (operation.action === 'overview') {
    const fields = operation.fields || {}
    if (fields.title) lines.push(`标题：${fields.title}`)
    if (fields.style) lines.push(`风格：${fields.style}`)
    if (fields.summary) lines.push(`摘要：${fields.summary}`)
  }
  if (operation.action === 'film') {
    lines.push(...callSite(skillFilePath('meiji-film'), 'videoRequestMode（server/generate/film.js）'))
    lines.push(...callSite('server/generate/film.js', 'submitH3'))
    lines.push(...formatFilmRequest(operation))
  }
  if (operation.itemName) lines.push(operation.itemName)
  if (operation.instruction) lines.push(operation.instruction)
  if (operation.name) lines.push(operation.name)
  lines.push('工具：meiji_panel（tools/tool-panel.js 的 execute）')
  lines.push('调用 meiji_panel 执行，必须传入上面的 operationId。不要改写正文，不要自动进入下一步。')
  return lines.join('\n')
}

function services(home) {
  return { projects: projectStore(home), models: modelStore(home), library: assetStore(home) }
}



async function openingFrame(project, track, home, projects, lastFrameOf) {
  const rows = (project.storyboard || []).filter(item => /^S[0-9]{2,}$/.test(item.id))
  const index = rows.findIndex(item => item.id === track)
  if (index <= 0) return {}
  const previous = rows[index - 1].id
  const current = await projects.read(project.id)
  if (current.films?.[previous]?.status !== 'ready') {
    throw Object.assign(new Error(`请先完成上一镜 ${previous} 的成片，再生成 ${track}`), { status: 409 })
  }
  const frame = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '', `${previous}-last.png`)
  let png
  try {
    png = await readFile(frame)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const video = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '', `${previous}.mp4`)
    png = await lastFrameOf(video, frame)
  }
  return { previous, inputReference: Buffer.from(png).toString('base64') }
}

async function publishLocalReferences(project, images, { home, route, projects }) {
  for (const image of images) {
    if (!String(image.url || '').startsWith('/plugins/meiji/') || !image.id || !image.kind) continue
    const key = image.ownerId ? 'characters' : image.kind
    const owner = project[key]?.items.find(entry => entry.id === (image.ownerId || image.id))
    const source = image.ownerId ? owner?.[image.slot]?.find(entry => entry.id === image.id) : owner
    const still = await readPicture(home, project, source)
    const reference = source.assetId ? {} : await savePicture(home, still.bytes, still.mime, image.kind, source.name || source.id, { source: 'import', projectId: project.id, episodeId: project.episodeId, itemId: source.id })
    const ext = still.mime === 'image/jpeg' ? 'jpg' : still.mime === 'image/webp' ? 'webp' : 'png'
    const file = await uploadGatewayFile({ baseUrl: route.baseUrl, apiKey: route.apiKey, bytes: still.bytes, mime: still.mime, filename: `${image.id}.${ext}` })
    const bag = project[key]
    if (!bag?.items) continue
    const updated = pictureRecord({ ...source, ...reference, localPath: reference.localPath || source.localPath || image.url, imageUrl: file.url, file })
    const items = bag.items.map(entry => entry.id !== owner.id ? entry : image.ownerId
      ? { ...entry, [image.slot]: entry[image.slot].map(part => part.id === image.id ? updated : part) }
      : updated)
    project[key] = { ...bag, items }
    await projects.save(project.id, { [key]: project[key] })
  }
}

export function previewFilmSubmit(project, item) {
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  const shot = (project.shots?.items || []).find(entry => entry.id === item.id)
  const wantsFrame = wantsOpeningFrame({
    video: item.video,
    link: item.link,
    continuity: `${shot?.continuity || ''} ${item.carryIn || ''}`,
    imageCount: images.length,
  })
  const payload = filmSubmit(project, item, wantsFrame ? { previous: '', inputReference: 'frame' } : {})
  return {
    model: 'elysium-video',
    seconds: item.duration,
    quality: 'medium',
    mode: payload.mode,
    prompt: payload.prompt,
    referenceImages: payload.referenceImages || [],
    inputReference: payload.mode === 'first_frame' ? (payload.note || '上一镜尾帧') : '',
  }
}

export function formatFilmRequest(fields) {
  const lines = [
    '最终提交参数：',
    `model: ${fields.model || 'elysium-video'}`,
    `seconds: ${fields.seconds ?? ''}`,
    `quality: ${fields.quality || 'medium'}`,
    `mode: ${fields.mode || ''}`,
  ]
  if (fields.referenceImages?.length) lines.push(`reference_images: ${JSON.stringify(fields.referenceImages)}`)
  if (fields.inputReference) lines.push(`input_reference: ${fields.inputReference}`)
  lines.push('prompt:')
  if (fields.prompt) lines.push(fields.prompt)
  return lines
}

function filmSubmit(project, item, opening) {
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  const shot = (project.shots?.items || []).find(entry => entry.id === item.id)
  const mode = videoRequestMode({
    video: item.video,
    link: item.link,
    continuity: `${shot?.continuity || ''} ${item.carryIn || ''}`,
    hasOpening: Boolean(opening.inputReference),
    imageCount: images.length,
  })
  const basePrompt = item.format === 'text' ? storyboardPromptText(item) : bindReferencePrompt(storyboardPromptText(item), mode === 'reference' ? images : [])
  const supplement = skillSupplement(project, 'meiji-film')
  const prompt = supplement ? `${basePrompt}\n${supplement}` : basePrompt
  if (mode === 'reference') {
    return {
      mode,
      prompt,
      referenceImages: images.map(image => image.url),
      note: `参考图：${images.map(image => image.label).join('，')}`,
    }
  }
  if (mode === 'first_frame') {
    return {
      mode,
      prompt,
      inputReference: opening.inputReference,
      note: `首帧：上一镜 ${opening.previous} 的尾帧`,
    }
  }
  return { mode, prompt, note: '文生视频：不上传首帧和参考图' }
}

async function keepLastFrame(directory, track, saveFrame) {
  const video = join(directory, `${track}.mp4`)
  const frame = join(directory, `${track}-last.png`)
  await saveFrame(video, frame)
  return `${track}-last.png`
}

const filmWrites = new Map()

async function writeFilm(projects, projectId, track, patch) {
  const previous = filmWrites.get(projectId) || Promise.resolve()
  const job = previous.catch(() => {}).then(async () => {
    const current = await projects.read(projectId)
    const films = { ...(current.films || {}) }
    films[track] = { ...(films[track] || {}), ...patch }
    const next = { films, assembly: null }
    if ((patch.status === 'ready' || patch.status === 'error') && current.activity === `film:${track}`) next.activity = null
    await projects.save(projectId, next)
  })
  filmWrites.set(projectId, job)
  try { return await job }
  finally { if (filmWrites.get(projectId) === job) filmWrites.delete(projectId) }
}

const running = new Set()

export async function runOperation(operation, deps) {
  const key = operation.projectId ? resolve(deps.home, 'storages', 'meiji', 'projects', operation.projectId) : null
  if (key && running.has(key)) throw Object.assign(new Error('上一项面板操作还在进行'), { status: 409 })
  if (key) running.add(key)
  const background = []
  const operationId = randomUUID()
  const finish = async () => {
    try {
      if (key) await projectStore(deps.home).save(operation.projectId, current => {
        if (current.activeOperation !== operationId) return null
        const message = '任务已停止，未覆盖更新后的项目数据，请刷新后重试'
        return { activity: null, activeOperation: null, activityError: message, episodes: (current.episodes || []).map(episode => episode.activity ? { ...episode, activity: null, activityError: message } : episode) }
      })
    } finally { if (key) running.delete(key) }
  }
  try {
    const trace = await checkContext.run({ review: '' }, () => executeOperation(operation, { ...deps, operationId, defer: job => { background.push(job) } }))
    trace.status = background.length ? 'running' : 'completed'
    return trace
  } finally {
    if (background.length) void Promise.allSettled(background).then(finish).catch(() => {})
    else await finish()
  }
}

async function executeOperation(operation, deps) {
  const { home } = deps
  const { projects: storedProjects, models, library } = services(home)
  let rootProjects = revisionStore(storedProjects, deps.operationId)
  let projects = rootProjects
  const trace = []
  const note = line => { trace.push(line) }
  if (operation.sessionId && operation.projectId) await linkStore(home).requireProject(operation.sessionId, operation.projectId)
  try {
    if (operation.action === 'open') {
      const title = String(operation.title || '').trim()
      const matches = (await projects.list()).filter(item => item.title === title)
      if (matches.length !== 1) {
        throw Object.assign(new Error(matches.length ? '有多部同名短剧，请在工作区目录里点开其中一部' : '没有找到这部短剧，请从工作区目录里选择'), { status: 404 })
      }
      await linkStore(home, deps.workspaceController).ensureProject(matches[0].id, projects)
      note(`请在片库选择《${matches[0].title}》，进入它的专属工作区`)
      return trace
    }
    if (operation.action === 'create') {
      const created = await projects.create(operation.fields)
      await linkStore(home, deps.workspaceController).ensureProject(created.id, projects)
      note(`请在片库选择《${created.title}》，进入它的专属工作区`)
      note(`已创建项目 ${created.title}`)
      note(`编号 ${created.id}，画幅 ${created.aspectRatio}${created.style ? `，风格 ${created.style}` : ''}`)
      note('下一步是在项目概要里添加剧集')
      return trace
    }
    if (operation.action === 'library-import') {
      const incoming = await openIncoming(home, operation.incomingId)
      const metadata = await library.import(operation.category, operation.name, createReadStream(incoming.file))
      await rm(incoming.directory, { recursive: true, force: true })
      note(`已导入素材 ${metadata.originalName} 到${operation.category}`)
      note(`素材编号 ${metadata.id}`)
      return trace
    }
    let project = operation.projectId ? normalizeProject(await rootProjects.read(operation.projectId)) : null
    if (!project) throw Object.assign(new Error('没有找到项目'), { status: 404 })
    if (project.activity) throw Object.assign(new Error('上一项面板操作还在进行'), { status: 409 })
    if (operation.action === 'overview') {
      const saved = await rootProjects.save(project.id, overviewPatch(project, operation.fields))
      if (saved.workspaceId && deps.workspaceController) await linkStore(home, deps.workspaceController).ensureProject(saved.id, rootProjects)
      note(`已保存项目概要：${saved.title}`)
      note(`画幅 ${saved.aspectRatio}`)
      if (saved.style) note(`风格 ${saved.style}`)
      note(saved.summary)
      return trace
    }
    if (operation.action === 'episode-generate') {
      const existing = operation.episodeId ? project.episodes.find(episode => episode.id === operation.episodeId) : null
      if (operation.episodeId && !existing) throw Object.assign(new Error('这一集不存在'), { status: 404 })
      if (existing) {
        const prepared = await prepareChecks(scopeProjects(rootProjects, existing.id), materialize(project, existing.id), operation)
        operation = prepared.operation
        project = normalizeProject(await rootProjects.read(project.id))
      }
      await rootProjects.save(project.id, { activity: 'episode', activityError: null })
      note('按 meiji-episode 生成本集剧情')
      note('工具：meiji_episode（tools/tool-episode.js 的 execute）')
      note('文件：' + skillFilePath('meiji-episode'))
      note('函数：generateEpisode（server/generate/story.js）')
      const draft = await (deps.generateEpisode || generateEpisode)({ route: (await loadModels(models)).story, project, episodeId: operation.episodeId })
      const patch = existing
        ? editEpisode(project, existing.id, { summary: draft.summary, durationSeconds: existing.durationSeconds })
        : addEpisode(project, draft)
      if (existing) { const updated = patch.episodes.find(episode => episode.id === existing.id); setCheck(updated, operation, []) }
      await rootProjects.save(project.id, { ...patch, activity: null, activityError: null })
      note(existing ? `已重新生成第 ${project.episodes.length - project.episodes.findIndex(episode => episode.id === existing.id)} 集摘要，保留 ${existing.durationSeconds} 秒时长` : `已生成第 ${patch.episodes.length} 集，${draft.durationSeconds} 秒`)
      if (existing && existing.summary !== draft.summary) note('本集下游制作数据已重置，需要重新生成')
      note(draft.summary)
      return trace
    }
    if (operation.action === 'episode-add' || operation.action === 'episode-edit') {
      const patch = operation.action === 'episode-add'
        ? addEpisode(project, operation.fields)
        : editEpisode(project, operation.episodeId, operation.fields)
      const episode = operation.action === 'episode-add' ? patch.episodes[0] : patch.episodes.find(item => item.id === operation.episodeId)
      if (operation.incomingId) {
        const incoming = await openIncoming(home, operation.incomingId)
        episode.cover = await writeEpisodeCover(home, project.id, episode.id, incoming.file, incoming.mime)
        await rm(incoming.directory, { recursive: true, force: true })
      }
      const previous = project.episodes.find(item => item.id === episode.id)
      await rootProjects.save(project.id, patch)
      note(operation.action === 'episode-add' ? `已添加剧集，${episode.durationSeconds} 秒` : `已保存剧集，${episode.durationSeconds} 秒`)
      if (previous && (previous.summary !== episode.summary || previous.durationSeconds !== episode.durationSeconds)) {
        note('本集时长或摘要一变，这一集的简报之后会重新待审')
      }
      return trace
    }
    if (episodeScoped.has(operation.action) && !operation.episodeId && (operation.sessionId || project.episodes.length)) {
      if (project.episodes.length !== 1) throw Object.assign(new Error('请指定 episodeId 或从对应剧集面板发起操作'), { status: 409 })
      operation = { ...operation, episodeId: project.episodes[0].id }
    }
    if (operation.episodeId && episodeScoped.has(operation.action)) {
      project = materialize(project, operation.episodeId)
      projects = scopeProjects(rootProjects, operation.episodeId)
    }
    if (operation.action === 'confirm-image' || operation.action === 'discard-image') {
      if (!deps.imageReviewAllowed) throw Object.assign(new Error('请在图片预览中点击确认或放弃'), { status: 403 })
      const draft = project.pendingImages?.[operation.draftId]
      if (!draft) throw Object.assign(new Error('图片已处理或已失效，请刷新'), { status: 409 })
      const feedback = structuredClone(project.feedback || {})
      const targetKey = feedbackKey({ action: draft.track ? 'pencil' : draft.slot ? 'part-image' : 'image', track: draft.track, itemId: draft.itemId, slot: draft.slot })
      feedback[targetKey] = structuredClone(feedbackOf(project, targetKey))
      feedback[targetKey].review.status = operation.action === 'confirm-image' ? 'approved' : 'changes-requested'
      const pendingImages = { ...project.pendingImages }
      delete pendingImages[draft.draftId]
      if (operation.action === 'discard-image') {
        await projects.save(project.id, { pendingImages, feedback })
        const file = await readImageDraft(home, draft.draftId)
        await rm(file.directory, { recursive: true, force: true })
        note('已放弃生成图片，原图保持不变')
        return trace
      }
      const target = draft.track ? (project.storyboard || []).find(item => item.id === draft.track)
        : project[draft.key]?.items.find(item => item.id === draft.itemId)
      if (!target || pictureTargetSnapshot(target) !== draft.target) throw Object.assign(new Error('图片对应内容已修改，请放弃预览后重新生成'), { status: 409 })
      const file = await readImageDraft(home, draft.draftId)
      if (file.metadata.projectId !== project.id || file.metadata.episodeId !== project.episodeId) throw Object.assign(new Error('图片不属于当前剧集'), { status: 409 })
      await projects.save(project.id, { activity: 'confirm-image', activityError: null })
      const route = (await loadModels(models)).video
      const uploaded = await (deps.uploadGatewayFile || uploadGatewayFile)({ baseUrl: route.baseUrl, apiKey: route.apiKey,
        bytes: file.bytes, mime: file.metadata.mime, filename: `${draft.draftId}.${file.metadata.mime === 'image/jpeg' ? 'jpg' : file.metadata.mime.split('/')[1]}` })
      if (!/^https?:\/\//i.test(uploaded.url || '')) throw new Error('上传接口未返回有效的 imageUrl')
      const reference = await savePicture(home, file.bytes, file.metadata.mime, file.metadata.category, file.metadata.name, { ...file.metadata, imageUrl: uploaded.url })
      let patch
      if (draft.track) patch = { boards: { ...project.boards, [draft.track]: { ...reference, url: reference.localPath } } }
      else if (draft.slot) patch = { ...staleMedia(project), [draft.key]: appendImageAsset(project[draft.key], draft.itemId, draft.slot, { id: nextPartId(target, draft.slot), name: draft.name, ...reference }) }
      else patch = { ...staleMedia(project), [draft.key]: { ...project[draft.key], items: project[draft.key].items.map(item => item.id === draft.itemId ? pictureRecord({ ...item, ...reference }) : item) } }
      try { await projects.save(project.id, { ...patch, pendingImages, feedback, activity: null, activityError: null }) }
      catch (error) {
        await rm(join(home, 'storages', 'meiji', 'assets', reference.assetCategory, reference.assetId), { recursive: true, force: true })
        throw error
      }
      await rm(file.directory, { recursive: true, force: true })
      note('图片已确认：上传完成，imageUrl 已保存，已入素材库并更新关联')
      return trace
    }
    const submittedReview = String(operation.review || '').trim()
    const prepared = await prepareChecks(projects, project, operation)
    projects = prepared.store
    project = prepared.project
    operation = prepared.operation
    if (['storyboard', 'shot-boards'].includes(operation.action) && !canGenerate(project, 'storyboard')) {
      throw Object.assign(new Error('镜头表尚未通过自检：' + (feedbackOf(project, 'shots').check.failures || ['请先生成并检查镜头表']).join('；')), { status: 409 })
    }
    if (operation.action === 'image' || operation.action === 'revise-image') {
      const lines = await startImage(operation, project, { projects, models, home, submitAssetImage: deps.submitAssetImage || submitAssetImage, defer: deps.defer })
      return lines
    }
    if (operation.action === 'part-image') {
      return startPartImage(operation, project, { projects, models, home, generateStillFile: deps.generateStillFile || generateStillFile, defer: deps.defer })
    }
    if (operation.action === 'source') {
      const saved = await projects.saveSource(project.id, operation.fields)
      note(`已保存资料：${saved.title}，${saved.durationSeconds} 秒，${saved.aspectRatio}`)
      note('时长、画幅或摘要一变，后面的内容已清空，等待重新生成')
      return trace
    }
    if (operation.action === 'outline-text') {
      const outline = String(operation.outline || '').trim()
      if (!outline) throw Object.assign(new Error('大纲不能是空的'), { status: 400 })
      await projects.writeStep(project.id, 'outline', { outline })
      note(`大纲已改写，共 ${outline.length} 字`)
      note('角色之后的内容已清空，等待重新生成')
      return trace
    }
    if (operation.action === 'outline') {
      if (!canGenerate(project, 'outline')) throw Object.assign(new Error('请先写好本集摘要，再写大纲'), { status: 409 })
      await projects.save(project.id, { activity: 'outline', activityError: null })
      note('按 meiji-outline 写故事大纲，不写景别和运镜')
      const outline = await generateOutline({ route: (await loadModels(models)).story, project })
      await projects.writeStep(project.id, 'outline', { outline, activity: null })
      note(`大纲已写入，共 ${outline.length} 字。角色之后的内容已清空，等待重新生成`)
      return trace
    }
    if (operation.action === 'characters') {
      if (!canGenerate(project, 'characters')) throw Object.assign(new Error('请先写好故事大纲，再做角色卡'), { status: 409 })
      await projects.save(project.id, { activity: 'characters', activityError: null })
      note('按 meiji-characters 写角色卡')
      const characters = await generateCharacters({ route: (await loadModels(models)).story, project })
      const previous = new Map((project.characters?.items || []).map(item => [item.name, item]))
      characters.items = characters.items.map(item => {
        const old = previous.get(item.name)
        return old?.localPath || old?.imageUrl || old?.file ? { ...item, ...pictureRecord(old) } : item
      })
      await projects.writeStep(project.id, 'characters', { characters, activity: null })
      note(`角色卡已写入，共 ${characters.items.length} 张。场景之后的内容已清空，等待重新生成`)
      return trace
    }
    if (operation.action === 'scenes') {
      if (!canGenerate(project, 'scenes')) throw Object.assign(new Error('请先写好角色卡，再做场景卡'), { status: 409 })
      await projects.save(project.id, { activity: 'scenes', activityError: null })
      note('按 meiji-scenes 写场景卡。场景里不出现人')
      const scenes = await generateScenes({ route: (await loadModels(models)).story, project })
      const previousScenes = new Map((project.scenes?.items || []).map(item => [item.name, item]))
      scenes.items = scenes.items.map(item => {
        const old = previousScenes.get(item.name)
        return old?.localPath || old?.imageUrl || old?.file ? { ...item, ...pictureRecord(old) } : item
      })
      await projects.writeStep(project.id, 'scenes', { scenes, activity: null })
      note(`场景卡已写入，共 ${scenes.items.length} 张。镜头表之后的内容已清空，等待重新生成`)
      return trace
    }
    if (operation.action === 'shot-assets') {
      const shot = project.shots?.items.find(item => item.id === operation.track)
      if (!shot) throw Object.assign(new Error('没有这一镜'), { status: 404 })
      const cast = (project.characters?.items || []).filter(item => operation.characterIds?.includes(item.id)).map(item => item.name)
      const scene = (project.scenes?.items || []).find(item => item.id === operation.sceneId)?.name || ''
      const patch = clearShotDownstream(project, 'storyboard', shot.id)
      await projects.save(project.id, { ...patch, shots: { ...project.shots, items: project.shots.items.map(item => item.id === shot.id ? { ...item, cast, scene, reference_images: operation.referenceIds || [] } : item) }, activity: null })
      note(`${shot.id} 素材关联已保存，请重新生成文本分镜`)
      return trace
    }
    if (operation.action === 'shots') {
      if (!canGenerate(project, 'shots')) throw Object.assign(new Error('请先写好场景卡，再写镜头表'), { status: 409 })
      project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots'), activity: 'shots', activityError: null })
      const review = String(operation.review || '').trim()
      if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
      note('按预设镜头编号和时长逐镜生成原文')
      if (submittedReview) note(`审核意见：${submittedReview}`)
      const failures = feedbackOf(project, 'shots').check.failures
      if (failures.length) note(`自检未通过：${failures.join('；')}`)
      const shots = await (deps.generateShots || generateShots)({ route: (await loadModels(models)).story, project, review, persist: shots => projects.save(project.id, { shots }) })
      await projects.writeStep(project.id, 'shots', {
        shots,
        activity: null,
      })
      note(shots.check.passed ? `镜头表已通过自检，共 ${shots.items.length} 镜。` : `镜头表已写入，自检未通过：${shots.check.failures.join('；')}`)
      note('每秒指令需要在镜头表里单独生成')
      return trace
    }
    if (operation.action === 'seconds') {
      const items = project.shots?.items || []
      if (!items.length) throw Object.assign(new Error('请先写好镜头表，再写每秒指令'), { status: 409 })
      project = await projects.save(project.id, { ...clearShotDownstream(project, 'seconds'), activity: 'seconds', activityError: null })
      note('按镜头顺序写每秒指令')
      const writeSeconds = deps.generateShotSeconds || generateShotSeconds
      let current = await projects.read(project.id)
      for (const shot of current.shots?.items || []) {
        note('文件：' + skillFilePath('meiji-shot-seconds'))
        note('函数：generateShotSeconds（server/generate/story.js）')
        note(`写 ${shot.id} 的每一秒`)
        selectCheck(current, { action: 'shot-seconds', track: shot.id })
        const next = await writeSeconds({ route: (await loadModels(models)).story, shotId: shot.id, project: current })
        await projects.save(project.id, { shots: next, storyboard: null, boards: {}, films: {}, assembly: null, activity: 'seconds' })
        current = await projects.read(project.id)
      }
      await projects.save(project.id, { activity: null })
      note('每秒指令已写完')
      return trace
    }
    if (operation.action === 'revise-shot') {
      const review = String(operation.review || '').trim()
      if (!review || review.length > 2000) throw Object.assign(new Error('请先写下这一镜的审核意见'), { status: 400 })
      const track = String(operation.track || '')
      const items = project.shots?.items || []
      if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
      if (!canGenerate(project, 'shots')) throw Object.assign(new Error('请先写好场景卡，再改镜头'), { status: 409 })
      project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots', track), activity: `revise-shot:${track}`, activityError: null })
      note(`文件：server/generate/story.js`)
      note('函数：reviseShot')
      note(`重写 ${track}`)
      note(`审核意见：${review}`)
      const shots = await reviseShot({
        route: (await loadModels(models)).story, shotId: track, review,
        project,
      })
      await projects.writeStep(project.id, 'shots', { shots, activity: null })
      note(shots.check.passed ? `${track} 已重写，镜头表通过自检。` : `${track} 已重写，自检未通过：${shots.check.failures.join('；')}`)
      return trace
    }
    if (operation.action === 'shot-seconds') {
      const track = String(operation.track || '')
      const items = project.shots?.items || []
      if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
      const review = String(operation.review || '').trim()
      if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
      project = await projects.save(project.id, { ...clearShotDownstream(project, 'seconds', track), activity: `shot-seconds:${track}`, activityError: null })
      note('文件：' + skillFilePath('meiji-shot-seconds'))
      note('函数：generateShotSeconds（server/generate/story.js）')
      note(`写 ${track} 的每一秒`)
      if (review) note(`审核意见：${review}`)
      const shots = await (deps.generateShotSeconds || generateShotSeconds)({
        route: (await loadModels(models)).story, shotId: track, project, review,
      })
      await projects.save(project.id, { shots, activity: null })
      const row = shots.items.find(item => item.id === track)
      note(`${track} 已生成指令原文，目标时长 ${row?.duration || 0} 秒`)
      return trace
    }
    if (operation.action === 'shot-storyboard') {
      if (feedbackOf(project, `seconds:${operation.track}`).check.passed === false) throw Object.assign(new Error('这一镜每秒指令自检未通过，请先修正'), { status: 409 })
      const track = String(operation.track || '')
      if (!(project.shots?.items || []).some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
      if (!shotSecondsReady(project.shots.items.find(item => item.id === track))) throw Object.assign(new Error('请先写好这一镜的每秒指令'), { status: 409 })
      const review = String(operation.review || '').trim()
      if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
      project = await projects.save(project.id, { ...clearShotDownstream(project, 'storyboard', track), activity: `shot-storyboard:${track}`, activityError: null })
      note('文件：' + skillFilePath('meiji-storyboard'))
      note('函数：generateShotStoryboard（server/generate/story.js）')
      note(`写 ${track} 的文本分镜。每秒指令原样进入面板，并检查身份、声音和参考图绑定`)
      if (review) note(`审核意见：${review}`)
      const storyboard = await (deps.generateShotStoryboard || generateShotStoryboard)({
        route: (await loadModels(models)).story, shotId: track, project, review,
      })
      const films = { ...(project.films || {}) }
      delete films[track]
      const boards = { ...(project.boards || {}) }
      delete boards[track]
      await projects.save(project.id, { storyboard, films, boards, assembly: null, activity: null })
      note(`${track} 的分镜已写入。这一镜的铅笔分镜和成片已清空`)
      return trace
    }
    if (operation.action === 'shot-boards') {
      const ids = (project.shots?.items || []).map(item => item.id)
      if (!ids.length) throw Object.assign(new Error('请先写好镜头表'), { status: 409 })
      project = await projects.save(project.id, { ...clearShotDownstream(project, 'seconds'), activity: 'shot-boards', activityError: null })
      note('按镜头顺序生成所有分镜')
      note('每一镜先写每秒指令，再写文本分镜')
      const writeSeconds = deps.generateShotSeconds || generateShotSeconds
      const writeBoard = deps.generateShotStoryboard || generateShotStoryboard
      for (const track of ids) {
        let current = await projects.read(project.id)
        note('文件：' + skillFilePath('meiji-shot-seconds'))
        note('函数：generateShotSeconds（server/generate/story.js）')
        note(`写 ${track} 的每一秒`)
        selectCheck(current, { action: 'shot-seconds', track })
        const shots = await writeSeconds({ route: (await loadModels(models)).story, shotId: track, project: current })
        await projects.save(project.id, { ...clearShotDownstream(current, 'seconds', track), shots, activity: 'shot-boards' })
        current = await projects.read(project.id)
        note('文件：' + skillFilePath('meiji-storyboard'))
        note('函数：generateShotStoryboard（server/generate/story.js）')
        note(`写 ${track} 的文本分镜。每秒指令原样进入面板，并检查身份、声音和参考图绑定`)
        selectCheck(current, { action: 'shot-storyboard', track })
        const storyboard = await writeBoard({ route: (await loadModels(models)).story, shotId: track, project: current })
        const films = { ...(current.films || {}) }
        delete films[track]
        const boards = { ...(current.boards || {}) }
        delete boards[track]
        await projects.save(project.id, { storyboard, films, boards, assembly: null, activity: 'shot-boards' })
        note(`${track} 的分镜已写入。这一镜的铅笔分镜和成片已清空`)
      }
      await projects.save(project.id, { activity: null })
      return trace
    }
    if (operation.action === 'import-image') {
      const place = visualPlace(project, operation.itemId)
      if (!place) throw Object.assign(new Error('请先写好角色卡或场景卡'), { status: 409 })
      let bytes
      let mime
      if (operation.data) {
        const decoded = decodeImageData(operation.data, operation.mime)
        bytes = decoded.bytes
        mime = decoded.mime
      } else {
        const incoming = await openIncoming(home, operation.incomingId)
        bytes = await readFile(incoming.file)
        mime = incoming.mime
        await rm(incoming.directory, { recursive: true, force: true })
      }
      const route = (await loadModels(models)).video
      if (!route?.apiKey || !route?.baseUrl) throw Object.assign(new Error('尚未配置视频网关。'), { status: 409 })
      const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
      const fileName = `${operation.itemId}.${ext}`
      const file = await uploadGatewayFile({ baseUrl: route.baseUrl, apiKey: route.apiKey, bytes, mime, filename: fileName })
      const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
      const bag = await importAssetImage({
        assets: place.bag, itemId: operation.itemId, projectId: project.id, episodeId: project.episodeId, directory,
        bytes, mime, file, home,
      })
      await projects.save(project.id, { ...staleMedia(project), [place.key]: bag, activity: null, activityError: null })
      const item = bag.items.find(entry => entry.id === operation.itemId)
      note(`已用上传的文件替换 ${item?.id || operation.itemId} ${item?.name || ''}`.trim())
      note(`网关文件：${file.id}`)
      return trace
    }
    if (operation.action === 'use-asset') {
      const place = visualPlace(project, operation.itemId)
      if (!place) throw Object.assign(new Error('人物或场景不存在'), { status: 404 })
      const file = await library.file(operation.category, operation.assetId)
      if (!file.metadata.mime.startsWith('image/')) throw Object.assign(new Error('请选择图片素材'), { status: 400 })
      const bag = { ...place.bag, items: place.bag.items.map(item => item.id === operation.itemId
        ? { ...item, ...pictureReference(file.metadata) } : item) }
      await projects.save(project.id, { ...staleMedia(project), [place.key]: bag, activity: null, activityError: null })
      note('已关联素材 ' + file.metadata.id)
      return trace
    }
    if (operation.action === 'clear-image') {
      const place = visualPlace(project, operation.itemId)
      if (!place) throw Object.assign(new Error('请先写好角色卡'), { status: 409 })
      const bag = clearCharacterImage(place.bag, operation.itemId)
      // Detach only: old images may still be referenced by other projects or videos.
      await projects.save(project.id, { ...staleMedia(project), [place.key]: bag, activity: null, activityError: null })
      const item = bag.items.find(entry => entry.id === operation.itemId)
      note(`已删除 ${item?.id || operation.itemId} ${item?.name || ''} 的绑定图片`.trim())
      return trace
    }
    if (operation.action === 'part-import') {
      const slot = operation.slot
      if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
      const place = visualPlace(project, operation.itemId)
      const character = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
      if (!character) throw Object.assign(new Error('只有人物可以添加衣服、道具或发型'), { status: 400 })
      let bytes
      let mime
      if (operation.data) {
        const decoded = decodeImageData(operation.data, operation.mime)
        bytes = decoded.bytes
        mime = decoded.mime
      } else {
        const incoming = await openIncoming(home, operation.incomingId)
        bytes = await readFile(incoming.file)
        mime = incoming.mime
        await rm(incoming.directory, { recursive: true, force: true })
      }
      const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : ''
      if (!ext) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP'), { status: 400 })
      const partId = nextPartId(character, slot)
      const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, `${partId}.${ext}`), bytes, { mode: 0o600 })
      const route = (await loadModels(models)).video
      let imageUrl = null
      if (route?.apiKey && route?.baseUrl) {
        const file = await uploadGatewayFile({ baseUrl: route.baseUrl, apiKey: route.apiKey, bytes, mime, filename: `${partId}.${ext}` })
        imageUrl = file.url
        note(`网关文件：${file.id}`)
      }
      const reference = await savePicture(home, bytes, mime, 'props', `${character.name}-${slot}`, { source: 'import', projectId: project.id, episodeId: project.episodeId, itemId: partId })
      const bag = appendImageAsset(place.bag, character.id, slot, {
        id: partId,
        name: `${partSlots[slot].label}${partId.slice(-2)}`,
        ...reference,
        imageUrl,
      })
      await projects.save(project.id, { ...staleMedia(project), [place.key]: bag, activity: null, activityError: null })
      note(`已导入 ${character.name} 的${partSlots[slot].label} ${partId}`)
      return trace
    }
    if (operation.action === 'storyboard') {
      if (!hasShots(project)) throw Object.assign(new Error('请先写好镜头表，再生成文本分镜'), { status: 409 })
      project = await projects.save(project.id, { ...clearShotDownstream(project, 'storyboard'), activity: 'storyboard', activityError: null })
      const writeSeconds = deps.generateShotSeconds || generateShotSeconds
      let current = project
      for (const shot of current.shots?.items || []) {
        if (shotSecondsReady(shot) && feedbackOf(current, `seconds:${shot.id}`).check.passed !== false) continue
        note('文件：' + skillFilePath('meiji-shot-seconds'))
        note('函数：generateShotSeconds（server/generate/story.js）')
        note(`写 ${shot.id} 的每一秒`)
        selectCheck(current, { action: 'shot-seconds', track: shot.id })
        const shots = await writeSeconds({ route: (await loadModels(models)).story, shotId: shot.id, project: current })
        await projects.save(project.id, { ...clearShotDownstream(current, 'seconds', shot.id), shots, activity: 'storyboard' })
        current = await projects.read(project.id)
      }
      selectCheck(current, { action: 'storyboard' })
      note('按 meiji-storyboard 生成全部分镜表，并审核原文剧情与素材关联')
      const storyboard = await (deps.generateStoryboard || generateStoryboard)({ route: (await loadModels(models)).story, project: current, persist: storyboard => projects.save(project.id, { storyboard }) })
      await projects.writeStep(project.id, 'storyboard', { storyboard, boards: {}, activity: null })
      note(`文本分镜已写入，共 ${storyboard.length} 镜。铅笔分镜和成片已清空，等待重新生成`)
      return trace
    }
    if (operation.action === 'pencil') {
      const track = String(operation.track || '')
      const item = (project.storyboard || []).find(entry => entry.id === track)
      if (!(item?.format === 'text' ? item.prompt?.text : item?.panels?.length) || !/^S[0-9]{2,}$/.test(track)) throw Object.assign(new Error('请先写好这一镜的文本分镜'), { status: 409 })
      const review = String(operation.review || '').trim()
      if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
      await projects.save(project.id, { activity: `pencil:${track}`, activityError: null })
      const base = pencilPrompt(item)
      const source = imageSkillPrompt('meiji-pencil-image', review ? `${base}\n审核意见：${review}` : base, project)
      const route = await loadModels(models)
      const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'boards', project.episodeId || '')
      const seed = imageSeed(`${project.id}:${track}:${Date.now()}`)
      const reference = await (deps.submitPencilBoard || submitPencilBoard)({
        directory, track, prompt: source, aspectRatio: '1344x768', backend: route.image, seed, home, projectId: project.id, episodeId: project.episodeId,
      })
      await stageImageDraft(projects, project, reference, { track, name: `${track} 铅笔分镜`, target: pictureTargetSnapshot(item) })
      note(`${track} 的铅笔分镜已生成，等待确认使用`)
      if (review) note(`审核意见：${review}`)
      note('提交的画面提示词：')
      note(source)
      return trace
    }
    if (operation.action === 'film') {
      if (feedbackOf(project, `storyboard:${operation.track}`).check.passed === false || feedbackOf(project, 'storyboard').check.passed === false) throw Object.assign(new Error('文本分镜自检未通过，请先修正'), { status: 409 })
      const track = String(operation.track || '')
      const item = (project.storyboard || []).find(entry => entry.id === track)
      if (!item || !/^S[0-9]{2,}$/.test(track)) throw Object.assign(new Error('请在对应镜头上提交这一条成片'), { status: 400 })
      if (!storyboardPromptText(item).trim()) throw Object.assign(new Error('请先生成这一镜的分镜'), { status: 409 })
      const route = (await loadModels(models)).video
      await publishLocalReferences(project, item.video === 'text' ? [] : shotReferenceImages(project, item), { home, route, projects })
      const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
      const shot = (project.shots?.items || []).find(entry => entry.id === track)
      const opening = wantsOpeningFrame({ video: item.video, link: item.link, continuity: `${shot?.continuity || ''} ${item.carryIn || ''}`, imageCount: images.length })
        ? await openingFrame(project, track, home, projects, deps.saveLastFrame || saveLastFrame)
        : {}
      const payload = filmSubmit(project, item, opening)
      await projects.save(project.id, { activity: `film:${track}`, activityError: null })
      try {
        const size = aspectRatioOf(project.aspectRatio)
        const queued = await (deps.submitH3 || submitH3)({ items: [{ track, duration: item.duration, ...payload }], route: (await loadModels(models)).video, projectId: project.id, aspectRatio: size, home })
        const shot = queued.shots[0]
        await writeFilm(projects, project.id, track, { status: 'running', promptId: shot.promptId, assetIds: images.map(image => image.assetId).filter(Boolean), error: null })
        note('已执行：提交成片')
        note('文件：server/generate/film.js')
        note('函数：submitH3')
        note(`${track}，时长 ${shot.duration} 秒`)
        note(payload.note)
        note(formatFilmRequest({ model: 'elysium-video', seconds: shot.duration, quality: 'medium', mode: payload.mode, size, prompt: payload.prompt, referenceImages: payload.referenceImages, inputReference: payload.mode === 'first_frame' ? payload.note : '' }).join('\n'))
        note('视频还在生成。完成后出现在这一张镜头卡片上。')
        deps.defer((deps.retrieveFilm || retrieveFilm)({ baseUrl: queued.baseUrl, promptId: shot.promptId, provider: queued.provider, apiKey: queued.apiKey }).then(async bytes => {
          const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '')
          await mkdir(directory, { recursive: true })
          await writeFile(join(directory, `${track}.mp4`), bytes)
          const lastFrameFile = await keepLastFrame(directory, track, deps.saveLastFrame || saveLastFrame)
          await writeFilm(projects, project.id, track, { status: 'ready', url: filmClipUrl(project.id, track, project.episodeId), lastFrame: lastFrameFile, error: null })
          insertSessionLog(deps.session, `${track} 成片已生成`)
        }).catch(async error => {
          await writeFilm(projects, project.id, track, { status: 'error', error: error.message || '成片生成失败' }).catch(() => {})
          insertSessionLog(deps.session, error.message || '成片生成失败', true)
        }))
        return trace
      } catch (error) {
        const current = await projects.read(project.id)
        if (current.activity === `film:${track}`) await projects.save(project.id, { activity: null, activityError: error.message })
        throw error
      }
    }
    if (operation.action === 'films') {
      const rows = (project.storyboard || []).filter(item => /^S[0-9]{2,}$/.test(item.id))
      if (!hasStoryboard(project)) throw Object.assign(new Error('请先写好本集全部文本分镜'), { status: 409 })
      if (rows.some(item => !storyboardPromptText(item).trim())) throw Object.assign(new Error('请先生成每一镜的分镜'), { status: 409 })
      if (rows.some(item => feedbackOf(project, `storyboard:${item.id}`).check.passed === false) || feedbackOf(project, 'storyboard').check.passed === false) throw Object.assign(new Error('文本分镜自检未通过，请先修正'), { status: 409 })
      await projects.save(project.id, { activity: 'films', activityError: null })
      note('按镜头顺序生成所有成片')
      note('文件：server/generate/film.js')
      note('函数：submitH3')
      for (const item of rows) {
        const track = item.id
        const current = await projects.read(project.id)
        selectCheck(current, { action: 'film', track })
        const route = (await loadModels(models)).video
        await publishLocalReferences(current, item.video === 'text' ? [] : shotReferenceImages(current, item), { home, route, projects })
        const images = item.video === 'text' ? [] : shotReferenceImages(current, item)
        const shotRow = (current.shots?.items || []).find(entry => entry.id === track)
        const opening = wantsOpeningFrame({ video: item.video, link: item.link, continuity: `${shotRow?.continuity || ''} ${item.carryIn || ''}`, imageCount: images.length })
          ? await openingFrame(current, track, home, projects, deps.saveLastFrame || saveLastFrame)
          : {}
        const payload = filmSubmit(current, item, opening)
        const size = aspectRatioOf(project.aspectRatio)
        const queued = await (deps.submitH3 || submitH3)({ items: [{ track, duration: item.duration, ...payload }], route: (await loadModels(models)).video, projectId: project.id, aspectRatio: size, home })
        const shot = queued.shots[0]
        await writeFilm(projects, project.id, track, { status: 'running', promptId: shot.promptId, assetIds: images.map(image => image.assetId).filter(Boolean), error: null })
        note(`已提交 ${track}，时长 ${shot.duration} 秒`)
        note(payload.note)
        note(formatFilmRequest({ model: 'elysium-video', seconds: shot.duration, quality: 'medium', mode: payload.mode, size, prompt: payload.prompt, referenceImages: payload.referenceImages, inputReference: payload.mode === 'first_frame' ? payload.note : '' }).join('\n'))
        try {
          const bytes = await (deps.retrieveFilm || retrieveFilm)({ baseUrl: queued.baseUrl, promptId: shot.promptId, provider: queued.provider, apiKey: queued.apiKey })
          const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '')
          await mkdir(directory, { recursive: true })
          await writeFile(join(directory, `${track}.mp4`), bytes)
          const lastFrameFile = await keepLastFrame(directory, track, deps.saveLastFrame || saveLastFrame)
          await writeFilm(projects, project.id, track, { status: 'ready', url: filmClipUrl(project.id, track, project.episodeId), lastFrame: lastFrameFile, error: null })
          note(`${track} 成片已生成`)
        } catch (error) {
          await writeFilm(projects, project.id, track, { status: 'error', error: error.message || '成片生成失败' }).catch(() => {})
          throw error
        }
      }
      await projects.save(project.id, { activity: null })
      return trace
    }
    if (operation.action === 'assemble') {
      const rows = (project.storyboard || []).filter(item => /^S[0-9]{2,}$/.test(item.id))
      if (!hasFilm(project)) {
        throw Object.assign(new Error('请先完成本集全部镜头成片'), { status: 409 })
      }
      await projects.save(project.id, { activity: 'assemble', activityError: null })
      const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '')
      await mkdir(directory, { recursive: true })
      const inputs = project.shots.items.map(item => join(directory, `${item.id}.mp4`))
      const output = join(directory, 'assembly.mp4')
      note('按镜头顺序拼接成片')
      note('文件：server/generate/concat.js')
      note('函数：concatFilms')
      note(rows.map(item => item.id).join('、'))
      await (deps.concatFilms || concatFilms)({ inputs, output })
      const episode = project.episodeId ? `${encodeURIComponent(project.episodeId)}/` : ''
      const url = `/plugins/meiji/projects/${encodeURIComponent(project.id)}/films/${episode}assembly?v=${Date.now()}`
      await projects.save(project.id, { assembly: { status: 'ready', url, error: null }, activity: null })
      note('全片已拼接')
      return trace
    }
    throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  } catch (error) {
    if (operation.projectId) {
      try {
        const current = await rootProjects.read(operation.projectId)
        if (current.activeOperation === deps.operationId) {
          if (error.code === 'CONTENT_CHECK_FAILED' && operation.action === 'episode-generate' && operation.episodeId) {
            await scopeProjects(rootProjects, operation.episodeId).save(operation.projectId, view => setCheck(structuredClone(view), operation, [...feedbackOf(view, operation).check.failures, error.message]))
          }
          await projects.save(operation.projectId, { activity: null, activityError: error.message })
        }
      } catch { /* Conflicting results are discarded; the owner releases its activity in finish. */ }
    }
    throw error
  }
}

function visualPlace(project, itemId) {
  if ((project.characters?.items || []).some(item => item.id === itemId)) return { key: 'characters', bag: project.characters }
  if ((project.scenes?.items || []).some(item => item.id === itemId)) return { key: 'scenes', bag: project.scenes }
  return null
}

async function startImage(operation, project, { projects, models, home, submitAssetImage, defer }) {
  const place = visualPlace(project, operation.itemId)
  if (!place || (!hasCharacters(project) && !hasScenes(project))) throw Object.assign(new Error('请先写好角色卡或场景卡'), { status: 409 })
  const item = place.bag.items.find(entry => entry.id === operation.itemId)
  if (!item || (item.type !== 'role' && item.type !== 'scene')) throw Object.assign(new Error('只有角色和场景可以出图'), { status: 400 })
  await projects.save(project.id, { activity: `image:${item.id}`, activityError: null })
  const route = await loadModels(models)
  let bag = place.bag
  let how = '沿用这张卡已有的中文画面提示词'
  if (operation.action === 'revise-image') {
    const note = String(operation.instruction || operation.review || '').trim()
    if (!note || note.length > 2000) throw Object.assign(new Error(note ? '审核意见过长' : '请先写下审核意见'), { status: 400 })
    const revised = await askSkill('meiji-revise-image', `原提示词：${item.look || item.appearance || item.space || ''}\n新要求：${note}`, {
      route: route.story, project, maxTokens: 800,
    })
    if (!usableLook(revised)) throw Object.assign(new Error('新的画面提示词不够具体'), { status: 502 })
    bag = { ...bag, items: bag.items.map(entry => entry.id === item.id ? { ...entry, look: revised } : entry) }
    await projects.save(project.id, { [place.key]: bag })
    how = '已按审核意见改写画面提示词'
  } else if (!usableLook(item.look)) {
    throw Object.assign(new Error('这张卡还没有可用的中文画面提示词'), { status: 400 })
  }
  const current = bag.items.find(entry => entry.id === item.id)
  const submitted = imageSkillPrompt(current.type === 'role' ? 'meiji-character-image' : 'meiji-scene-image', current.type === 'role' ? characterStillPrompt(current) : sceneStillPrompt(current), project)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  let referenceBytes
  let reference = '文生图，不使用旧图'
  if (operation.action === 'revise-image' && !route.image?.apiKey) {
    try {
      referenceBytes = (await readPicture(home, project, current)).bytes
      reference = '带上当前图片作为重绘底图'
    } catch {
      reference = '还没有图片，按新提示词直接生成'
    }
  } else if (operation.action === 'revise-image') {
    reference = '按改写后的中文提示词重新生成'
  }
  const seed = imageSeed(`${item.id}:${Date.now()}`)
  const size = aspectRatioOf(project.aspectRatio)
  defer(submitAssetImage({
    assets: bag, itemId: item.id, aspectRatio: size, backend: route.image,
    projectId: project.id, episodeId: project.episodeId, directory, referenceBytes, seed, home, prompt: submitted,
  }).then(async next => {
    const draft = next.items.find(entry => entry.id === item.id).pendingImage
    await stageImageDraft(projects, project, draft, { key: place.key, itemId: item.id, name: item.name, target: pictureTargetSnapshot(current) })
  }).catch(async error => {
    await projects.save(project.id, { activity: null, activityError: error.message }).catch(() => {})
  }))
  return [
    `正在生成 ${item.id} ${item.name} 的图片`,
    how,
    '提交的画面提示词：' + submitted,
    `画幅 ${size}，新种子，生成后等待确认，确认上传后才会入库并使用`,
    reference,
  ]
}

async function startPartImage(operation, project, { projects, models, home, generateStillFile, defer }) {
  const slot = operation.slot
  if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以添加衣服、道具或发型'), { status: 400 })
  const review = String(operation.review || '').trim()
  if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
  const partId = nextPartId(item, slot)
  const base = partPrompt(item, slot)
  const submitted = imageSkillPrompt('meiji-part-image', review ? `${base}\n审核意见：${review}` : base, project)
  await projects.save(project.id, { activity: `image:${item.id}:${slot}`, activityError: null })
  const route = await loadModels(models)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  const seed = imageSeed(`${partId}:${Date.now()}`)
  const size = aspectRatioOf(project.aspectRatio)
  defer(generateStillFile({
    directory, itemId: partId, aspectRatio: size, backend: route.image,
    projectId: project.id, episodeId: project.episodeId, home, category: 'props', prompt: submitted, seed,
  }).then(async localPath => {
    await stageImageDraft(projects, project, localPath, { key: place.key, itemId: item.id, slot, name: `${item.name}·${partSlots[slot].label}`, target: pictureTargetSnapshot(item) })
  }).catch(async error => {
    await projects.save(project.id, { activity: null, activityError: error.message }).catch(() => {})
  }))
  return [
    `正在生成 ${item.name} 的${partSlots[slot].label} ${partId}`,
    review ? `审核意见：${review}` : '',
    '提交的画面提示词：' + submitted,
    `画幅 ${size}，灰白纯色背景`,
  ].filter(Boolean)
}

async function openIncoming(home, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw Object.assign(new Error('上传的文件已失效'), { status: 400 })
  const directory = join(home, 'storages', 'meiji', 'incoming', id)
  const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8'))
  return { directory, file: join(directory, 'file'), mime: meta.mime, name: meta.name }
}

export async function saveIncoming(home, { name, category, mime, bytes }) {
  if (!bytes?.length) throw Object.assign(new Error('文件是空的'), { status: 400 })
  const id = randomUUID()
  const directory = join(home, 'storages', 'meiji', 'incoming', id)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'file'), bytes, { mode: 0o600 })
  await writeFile(join(directory, 'meta.json'), JSON.stringify({ name, category: category || '', mime }) + '\n', { mode: 0o600 })
  return id
}

async function stageImageDraft(projects, project, draft, target) {
  if (!draft?.draftId) throw new Error('生成结果缺少待确认图片')
  await projects.save(project.id, current => ({ pendingImages: { ...current.pendingImages, [draft.draftId]: { ...draft, ...target } }, activity: null, activityError: null }))
}
