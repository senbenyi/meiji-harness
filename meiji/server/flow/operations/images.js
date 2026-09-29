// 图片操作：人物/场景/部件图片生成、导入、关联与清除，铅笔分镜，以及候选图片的确认与放弃。
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pictureReference, pictureTargetSnapshot, readImageDraft, readPicture, savePicture } from '../../data/pictures.js'
import { openIncoming } from './project.js'
import { loadModels } from './services.js'
import { decodeImageData } from '../../generate/character-views.js'
import { characterImageSize, uploadGatewayFile } from '../../generate/gateway.js'
import { appendImageAsset, characterImagePrompt, clearCharacterImage, clearCharacterReference, generateStillFile, imageSeed, imageSkillPrompt, importAssetImage, nextPartId, partPrompt, partSlots, pencilPrompt, pictureRecord, readStill, saveCharacterReference, sceneStillPrompt, submitAssetImage, submitPencilBoard, usableLook, withPartText } from '../../generate/image.js'
import { runTextSteps } from '../../generate/text-steps.js'
import { runStep } from '../../data/task-store.js'
import { buildTextPrompts } from '../../prompts/text-prompts.js'
import { GenerationStatus, finish, plotPatch, shotResults, targetNode, updateShotResult } from '../../../shared/drama-model.js'
import { feedbackKey } from '../../../shared/feedback.js'
import { aspectRatioOf, staleMedia } from '../../../shared/project-rules.js'
import { hasCharacters, hasScenes } from '../../../shared/gates.js'

export function visualPlace(project, itemId) {
  if ((project.plot.characters?.items || []).some(item => item.id === itemId)) return { key: 'characters', bag: project.plot.characters }
  if ((project.plot.scenes?.items || []).some(item => item.id === itemId)) return { key: 'scenes', bag: project.plot.scenes }
  return null
}

export async function startImage(operation, project, { projects, models, home, submitAssetImage, defer }) {
  const place = visualPlace(project, operation.itemId)
  if (!place || (!hasCharacters(project) && !hasScenes(project))) throw Object.assign(new Error('请先写好角色卡或场景卡'), { status: 409 })
  const item = place.bag.items.find(entry => entry.id === operation.itemId)
  if (!item || (item.type !== 'role' && item.type !== 'scene')) throw Object.assign(new Error('只有角色和场景可以出图'), { status: 400 })
  await projects.save(project.id, { activity: `image:${item.id}`, activityError: null })
  const route = await loadModels(models)
  let bag = place.bag
  let how = '沿用这张卡已有的中文画面提示词'
  if (operation.generationMode === 'modify') {
    const note = String(operation.instruction || operation.review || '').trim()
    if (!note || note.length > 2000) throw Object.assign(new Error(note ? '审核意见过长' : '请先写下审核意见'), { status: 400 })
    const revision = await runTextSteps({ target: `image:${item.id}`, prompts: buildTextPrompts({ skill: 'image-prompt', project, instructions: `原提示词：${item.look || item.appearance || item.space || ''}\n新要求：${note}` }), options: {
      route: route.story, project,
    } })
    const revised = revision.text
    if (!usableLook(revised)) throw Object.assign(new Error('新的画面提示词不够具体'), { status: 502 })
    bag = { ...bag, items: bag.items.map(entry => entry.id === item.id ? { ...entry, look: revised } : entry) }
    if (!revision.check.passed) {
      await projects.save(project.id, { activity: null })
      throw Object.assign(new Error(`自检未通过：${revision.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
    }
    how = '已按审核意见改写画面提示词'
  } else if (!usableLook(item.look)) {
    throw Object.assign(new Error('这张卡还没有可用的中文画面提示词'), { status: 400 })
  }
  const current = bag.items.find(entry => entry.id === item.id)
  const submitted = current.type === 'role' ? characterImagePrompt(current, project) : imageSkillPrompt('scene-image', sceneStillPrompt(current), project)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  let referenceBytes
  let referenceImage
  let reference = '纯文字生图'
  if (operation.action === 'revise-image' && !route.image?.apiKey) {
    try {
      referenceBytes = (await readPicture(home, project, current)).bytes
      reference = '带上当前图片作为重绘底图'
    } catch {
      reference = '还没有图片，按新提示词直接生成'
    }
  } else if (operation.action === 'revise-image') {
    reference = '按改写后的中文提示词重新生成'
  } else if (operation.useReference) {
    if (current.type !== 'role') throw Object.assign(new Error('只有人物可以按参考图生图'), { status: 400 })
    let file
    try { file = await readStill(directory, `${current.id}-ref`) }
    catch (error) {
      if (error?.code === 'ENOENT') throw Object.assign(new Error('请先上传参考图'), { status: 400 })
      throw error
    }
    referenceBytes = file.bytes
    referenceImage = `data:${file.mime};base64,${file.bytes.toString('base64')}`
    reference = '按参考图生成'
  }
  const seed = imageSeed(`${item.id}:${Date.now()}`)
  const size = current.type === 'role' ? characterImageSize(operation.aspect) : aspectRatioOf(project.aspectRatio)
  defer(runStep('image_generate', () => submitAssetImage({
    assets: bag, itemId: item.id, aspectRatio: size, backend: route.image,
    projectId: project.id, episodeId: project.episodeId, directory, referenceBytes, referenceImage, seed, home, prompt: submitted,
  }).then(async next => {
    const draft = next.items.find(entry => entry.id === item.id).pendingImage
    await stageImageDraft(projects, project, draft, { key: place.key, itemId: item.id, name: item.name, target: pictureTargetSnapshot(item), aspect: current.type === 'role' ? (operation.aspect || '9:16') : '', useReference: Boolean(operation.useReference) })
  }), { target: `image:${item.id}` }).catch(async error => {
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

export async function startPartImage(operation, project, { projects, models, home, generateStillFile, defer }) {
  const slot = operation.slot
  if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以添加衣服、坐骑、道具或发型'), { status: 400 })
  const review = String(operation.review || '').trim()
  if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
  let current = item
  if (typeof operation.description === 'string') {
    current = withPartText(item, slot, operation.description)
    const bag = { ...place.bag, items: place.bag.items.map(entry => entry.id === item.id ? current : entry) }
    await projects.save(project.id, plotPatch(project, { [place.key]: bag }))
  }
  const partId = nextPartId(current, slot)
  const base = partPrompt(current, slot)
  const submitted = imageSkillPrompt('part-image', review ? `${base}\n审核意见：${review}` : base, project)
  await projects.save(project.id, { activity: `image:${item.id}:${slot}`, activityError: null })
  const route = await loadModels(models)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  const seed = imageSeed(`${partId}:${Date.now()}`)
  const size = aspectRatioOf(project.aspectRatio)
  defer(runStep('image_generate', () => generateStillFile({
    directory, itemId: partId, aspectRatio: size, backend: route.image,
    projectId: project.id, episodeId: project.episodeId, home, category: 'props', prompt: submitted, seed,
  }).then(async localPath => {
    await stageImageDraft(projects, project, localPath, { key: place.key, itemId: item.id, slot, name: `${item.name}·${partSlots[slot].label}`, target: pictureTargetSnapshot(current) })
  }), { target: `image:${item.id}:${slot}` }).catch(async error => {
    await projects.save(project.id, { activity: null, activityError: error.message }).catch(() => {})
  }))
  return [
    `正在生成 ${item.name} 的${partSlots[slot].label} ${partId}`,
    review ? `审核意见：${review}` : '',
    '提交的画面提示词：' + submitted,
    `画幅 ${size}，灰白纯色背景`,
  ].filter(Boolean)
}

export async function stageImageDraft(projects, project, draft, target) {
  if (!draft?.draftId) throw new Error('生成结果缺少待确认图片')
  await projects.save(project.id, current => ({ pendingImages: { ...current.pendingImages, [draft.draftId]: { ...draft, ...target } }, activity: null, activityError: null }))
}

// if (operation.action === 'confirm-image' || operation.action === 'discard-image')
async function opConfirmImage(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  if (!deps.imageReviewAllowed) throw Object.assign(new Error('请在图片预览中点击确认或放弃'), { status: 403 })
  const draft = project.pendingImages?.[operation.draftId]
  if (!draft) throw Object.assign(new Error('图片已处理或已失效，请刷新'), { status: 409 })
  const targetKey = feedbackKey({ action: draft.track ? 'pencil' : draft.slot ? 'part-image' : 'image', track: draft.track, itemId: draft.itemId, slot: draft.slot })
  const pendingImages = { ...project.pendingImages }
  delete pendingImages[draft.draftId]
  if (operation.action === 'discard-image') {
    await projects.save(project.id, current => { const next = structuredClone(current); next.pendingImages = pendingImages; const target = targetNode(next, targetKey); if (target) { target.operation = null; target.error = '已放弃候选图片'; target.status = GenerationStatus.FAILED }; return next })
    const file = await readImageDraft(home, draft.draftId)
    await rm(file.directory, { recursive: true, force: true })
    note('已放弃生成图片，原图保持不变')
    return trace
  }
  const target = draft.track ? shotResults(project, 'storyboard').find(item => item.id === draft.track)
    : project.plot[draft.key]?.items.find(item => item.id === draft.itemId)
  if (!target || pictureTargetSnapshot(target) !== draft.target) throw Object.assign(new Error('图片对应内容已修改，请放弃预览后重新生成'), { status: 409 })
  const file = await readImageDraft(home, draft.draftId)
  if (file.metadata.projectId !== project.id || file.metadata.episodeId !== project.episodeId) throw Object.assign(new Error('图片不属于当前剧集'), { status: 409 })
  await projects.save(project.id, { activity: 'confirm-image', activityError: null })
  const route = (await loadModels(models)).video
  const uploaded = await (deps.uploadGatewayFile || uploadGatewayFile)({ baseUrl: route.baseUrl, apiKey: route.apiKey,
    bytes: file.bytes, mime: file.metadata.mime, filename: `${draft.draftId}.${file.metadata.mime === 'image/jpeg' ? 'jpg' : file.metadata.mime.split('/')[1]}` })
  if (!/^https?:\/\//i.test(uploaded.url || '')) throw new Error('上传接口未返回有效的 imageUrl')
  const reference = await savePicture(home, file.bytes, file.metadata.mime, file.metadata.category, file.metadata.name, { ...file.metadata, imageUrl: uploaded.url })
  reference.prompt = file.metadata.prompt || ''
  let patch
  if (draft.track) patch = updateShotResult(project, 'pencil', draft.track, { ...reference, url: reference.localPath })
  else if (draft.slot) patch = { ...staleMedia(project), ...plotPatch(project, { [draft.key]: appendImageAsset(project.plot[draft.key], draft.itemId, draft.slot, { id: nextPartId(target, draft.slot), name: draft.name, ...reference }) }) }
  else patch = { ...staleMedia(project), ...plotPatch(project, { [draft.key]: { ...project.plot[draft.key], items: project.plot[draft.key].items.map(item => item.id === draft.itemId ? pictureRecord({ ...item, ...reference }) : item) } }) }
  try { await projects.save(project.id, current => { const next = { ...current, ...patch, pendingImages, activity: null, activityError: null }; finish(targetNode(next, targetKey), { passed: true, failures: [] }); return next }) }
  catch (error) {
    await rm(join(home, 'storages', 'meiji', 'assets', reference.assetCategory, reference.assetId), { recursive: true, force: true })
    throw error
  }
  await rm(file.directory, { recursive: true, force: true })
  note('图片已确认：上传完成，imageUrl 已保存，已入素材库并更新关联')
  return trace
}

// if (operation.action === 'image' || operation.action === 'revise-image')
async function opImage(c) {
  let { operation, deps, home, projects, models, project } = c
  const lines = await startImage(operation, project, { projects, models, home, submitAssetImage: deps.submitAssetImage || submitAssetImage, defer: deps.defer })
  return lines
}

// if (operation.action === 'part-image')
async function opPartImage(c) {
  let { operation, deps, home, projects, models, project } = c
  return startPartImage(operation, project, { projects, models, home, generateStillFile: deps.generateStillFile || generateStillFile, defer: deps.defer })
}

// if (operation.action === 'import-image')
async function opImportImage(c) {
  let { operation, home, projects, models, project, trace, note } = c
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
  await projects.save(project.id, { ...staleMedia(project), ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  const item = bag.items.find(entry => entry.id === operation.itemId)
  note(`已用上传的文件替换 ${item?.id || operation.itemId} ${item?.name || ''}`.trim())
  note(`网关文件：${file.id}`)
  return trace
}

async function readUploadedImage(operation, home) {
  if (operation.data) return decodeImageData(operation.data, operation.mime)
  const incoming = await openIncoming(home, operation.incomingId)
  const bytes = await readFile(incoming.file)
  const mime = incoming.mime
  await rm(incoming.directory, { recursive: true, force: true })
  return { bytes, mime }
}

async function opSetReference(c) {
  let { operation, home, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以设置参考图'), { status: 400 })
  const { bytes, mime } = await readUploadedImage(operation, home)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  const bag = await saveCharacterReference({
    assets: place.bag, itemId: item.id, projectId: project.id, episodeId: project.episodeId, directory, bytes, mime,
  })
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  note(`已设置 ${item.name} 的参考图`)
  return trace
}

async function opClearReference(c) {
  let { operation, home, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以移除参考图'), { status: 400 })
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  await Promise.all(['png', 'jpg', 'webp'].map(ext => rm(join(directory, `${item.id}-ref.${ext}`), { force: true })))
  const bag = clearCharacterReference(place.bag, item.id)
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  note(`已移除 ${item.name} 的参考图`)
  return trace
}

async function opPartText(c) {
  let { operation, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以编辑这类描述'), { status: 400 })
  const next = withPartText(item, operation.slot, operation.text)
  const bag = { ...place.bag, items: place.bag.items.map(entry => entry.id === item.id ? next : entry) }
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  note(`已保存 ${item.name} 的${partSlots[operation.slot]?.label || ''}描述`)
  return trace
}

// if (operation.action === 'use-asset')
async function opUseAsset(c) {
  let { operation, projects, library, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  if (!place) throw Object.assign(new Error('人物或场景不存在'), { status: 404 })
  const file = await library.file(operation.category, operation.assetId)
  if (!file.metadata.mime.startsWith('image/')) throw Object.assign(new Error('请选择图片素材'), { status: 400 })
  const bag = { ...place.bag, items: place.bag.items.map(item => item.id === operation.itemId
    ? pictureRecord({ ...item, ...pictureReference(file.metadata) }) : item) }
  await projects.save(project.id, { ...staleMedia(project), ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  note('已关联素材 ' + file.metadata.id)
  return trace
}

// if (operation.action === 'clear-image')
async function opClearImage(c) {
  let { operation, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  if (!place) throw Object.assign(new Error('请先写好角色卡'), { status: 409 })
  const bag = clearCharacterImage(place.bag, operation.itemId)
  // Detach only: old images may still be referenced by other projects or videos.
  await projects.save(project.id, { ...staleMedia(project), ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  const item = bag.items.find(entry => entry.id === operation.itemId)
  note(`已删除 ${item?.id || operation.itemId} ${item?.name || ''} 的绑定图片`.trim())
  return trace
}

// if (operation.action === 'part-import')
async function opPartImport(c) {
  let { operation, home, projects, models, project, trace, note } = c
  const slot = operation.slot
  if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const place = visualPlace(project, operation.itemId)
  const character = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!character) throw Object.assign(new Error('只有人物可以添加衣服、坐骑、道具或发型'), { status: 400 })
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
  await projects.save(project.id, { ...staleMedia(project), ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  note(`已导入 ${character.name} 的${partSlots[slot].label} ${partId}`)
  return trace
}

// if (operation.action === 'pencil')
async function opPencil(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  const track = String(operation.track || '')
  const item = shotResults(project, 'storyboard').find(entry => entry.id === track)
  if (!(item?.format === 'text' ? item.prompt?.text : item?.panels?.length) || !/^S[0-9]{2,}$/.test(track)) throw Object.assign(new Error('请先写好这一镜的文本分镜'), { status: 409 })
  const review = String(operation.review || '').trim()
  if (review.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
  await projects.save(project.id, { activity: `pencil:${track}`, activityError: null })
  const base = pencilPrompt(item)
  const source = imageSkillPrompt('pencil', review ? `${base}\n审核意见：${review}` : base, project)
  const route = await loadModels(models)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'boards', project.episodeId || '')
  const seed = imageSeed(`${project.id}:${track}:${Date.now()}`)
  await runStep('image_generate', async () => {
    const reference = await (deps.submitPencilBoard || submitPencilBoard)({
      directory, track, prompt: source, aspectRatio: '1344x768', backend: route.image, seed, home, projectId: project.id, episodeId: project.episodeId,
    })
    await stageImageDraft(projects, project, reference, { track, name: `${track} 铅笔分镜`, target: pictureTargetSnapshot(item) })
  }, { target: `pencil:${track}` })
  note(`${track} 的铅笔分镜已生成，等待确认使用`)
  if (review) note(`审核意见：${review}`)
  note('提交的画面提示词：')
  note(source)
  return trace
}

export const imageOperations = {
  'confirm-image': { stage: 'review', run: opConfirmImage },
  'discard-image': { stage: 'review', run: opConfirmImage },
  'image': { stage: 'episode', run: opImage },
  'revise-image': { stage: 'episode', run: opImage },
  'part-image': { stage: 'episode', run: opPartImage },
  'import-image': { stage: 'episode', run: opImportImage },
  'set-reference': { stage: 'episode', run: opSetReference },
  'clear-reference': { stage: 'episode', run: opClearReference },
  'use-asset': { stage: 'episode', run: opUseAsset },
  'clear-image': { stage: 'episode', run: opClearImage },
  'part-import': { stage: 'episode', run: opPartImport },
  'part-text': { stage: 'episode', run: opPartText },
  'pencil': { stage: 'episode', run: opPencil },
}
