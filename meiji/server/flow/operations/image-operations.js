import { createHash } from 'node:crypto'
import { runStep } from '../../runtime/task-execution.js'
import { checkContext } from '../../runtime/operation-context.js'
import { saveImageDraft, savePicture, pictureTargetSnapshot, readImageDraft, readPicture, pictureReference } from '../../data/image-storage.js'
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { generateGatewayImage, characterImageSize, gatewayImageSize } from '../../gateway/model-gateway.js'
import { replaceStill, stillExt, readStill } from '../../media/image-files.js'
import { assetImageUrl, imagePrompt, pictureRecord, usableLook, appendImageAsset, nextPartId, clearCharacterReference, partSlots, withPartText, clearCharacterImage } from '../../../shared/image-assets.js'
import { limitStillBytes } from '../../media/compress-image.js'
import { join } from 'node:path'
import { modelRoutes } from '../../../models/model-config.js'
import { propImagePrompt, imageSkillPrompt, pencilPrompt } from '../../prompts/image-prompts.js'
import { characterImagePrompt, characterImageGenerationModel, characterImageModificationModel } from '../../prompts/interfaces/character-image-interface.js'
import { sceneImagePrompt, sceneImageModificationModel } from '../../prompts/interfaces/scene-image-interface.js'
import { aspectRatioOf, staleMedia } from '../../../shared/project-rules.js'
import { consumeReview, targetNode, GenerationStatus, finish, plotPatch, shotResults, updateShotResult } from '../../../shared/drama-model.js'
import { feedbackKey } from '../../../shared/review-feedback.js'
import { openIncoming } from './project-operations.js'
import { decodeImageData } from '../../media/decode-image-data.js'

export function imageSeed(id) {
  return createHash('sha256').update(String(id)).digest().readUInt32BE(0)
}

const imageStep = (target, kind, run) => target ? runStep(kind, run, { target }) : run()

async function saveGeneratedImage(target, run, onSaved, signal) {
  return imageStep(target, 'image_save', async () => {
    signal ??= checkContext.getStore()?.signal
    signal?.throwIfAborted()
    const result = await run()
    signal?.throwIfAborted()
    if (onSaved) await onSaved(result)
    return result
  })
}

export async function submitPencilBoard({ directory, track, prompt, home, projectId, episodeId, aspectRatio = '1344x768', backend, fetchImpl, signal, seed = imageSeed(`${track}:${Date.now()}`), stepTarget, onSaved }) {
  const text = String(prompt || '').trim()
  if (!text) throw Object.assign(new Error('没有可提交的铅笔分镜提示词'), { status: 409 })
  await mkdir(directory, { recursive: true })
  const bytes = await generateGatewayImage({
    ...backend, prompt: text, aspectRatio, seed, fetchImpl, signal, stepTarget,
  })
  return saveGeneratedImage(stepTarget, async () => {
    if (!home) await replaceStill(directory, track, 'png', bytes)
    if (home) return saveImageDraft(home, bytes, 'image/png', 'scenes', `${track}-铅笔分镜`, { source: 'generated', projectId, episodeId, itemId: track, prompt: text })
  }, onSaved, signal)
}

export async function generateStillFile({ directory, itemId, aspectRatio, backend, projectId, episodeId, home, category = 'props', prompt, seed, fetchImpl, signal, stepTarget, onSaved }) {
  const text = String(prompt || '').trim()
  if (!text) throw Object.assign(new Error('没有可提交的画面提示词'), { status: 400 })
  await mkdir(directory, { recursive: true })
  const bytes = await generateGatewayImage({
    ...backend, prompt: text, aspectRatio, seed, fetchImpl, signal, stepTarget,
  })
  return saveGeneratedImage(stepTarget, async () => {
    const fitted = await limitStillBytes(bytes)
    if (!home) await replaceStill(directory, itemId, fitted.ext, fitted.bytes)
    if (home) return saveImageDraft(home, fitted.bytes, 'image/' + (fitted.ext === 'jpg' ? 'jpeg' : fitted.ext), category, itemId, { source: 'generated', projectId, episodeId, itemId, prompt: text })
    return assetImageUrl(projectId, itemId, seed, episodeId)
  }, onSaved, signal)
}

export async function submitAssetImage({ assets, itemId, aspectRatio, backend, projectId, episodeId, directory, fetchImpl, signal, prepare, referenceBytes, referenceMime, referenceBase64, seed = imageSeed(`${itemId}:${Date.now()}`), home, prompt, stepTarget, onSaved }) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || !['role', 'scene', 'prop'].includes(item.type)) throw Object.assign(new Error('只有角色、场景和道具可以生图'), { status: 400 })
  const prepared = prepare ? await prepare(assets) : assets
  const current = prepared.items.find(entry => entry.id === itemId)
  await mkdir(directory, { recursive: true })
  const bytes = await generateGatewayImage({
    ...backend,
    prompt: prompt || imagePrompt(current), aspectRatio, seed, references: referenceBytes ? [{ bytes: referenceBytes, mime: referenceMime }] : [], referenceBase64, fetchImpl, signal, stepTarget,
  })
  return saveGeneratedImage(stepTarget, async () => {
    const fitted = await limitStillBytes(bytes)
    if (!home) await replaceStill(directory, itemId, fitted.ext, fitted.bytes)
    const reference = home ? { pendingImage: await saveImageDraft(home, fitted.bytes, 'image/' + (fitted.ext === 'jpg' ? 'jpeg' : fitted.ext), current.type === 'prop' ? 'props' : current.type === 'role' ? 'characters' : 'scenes', current.name || itemId, { source: 'generated', projectId, episodeId, itemId, prompt: prompt || imagePrompt(current) }) } : { localPath: assetImageUrl(projectId, itemId, seed, episodeId) }
    const items = prepared.items.map(entry => entry.id === itemId ? pictureRecord({ ...entry, ...reference, file: null }) : entry)
    return { ...prepared, items }
  }, onSaved, signal)
}

export async function importAssetImage({ assets, itemId, projectId, episodeId, directory, bytes, mime, home }) {
  const ext = stillExt[mime]
  if (!ext) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP'), { status: 400 })
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 400 })
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || !['role', 'scene', 'prop'].includes(item.type)) throw Object.assign(new Error('只有角色、场景和道具可以导入图片'), { status: 400 })
  const version = Date.now()
  await replaceStill(directory, itemId, ext, bytes)
  await rm(join(directory, `${itemId}.job.json`), { force: true })
  const url = assetImageUrl(projectId, itemId, version, episodeId)
  const reference = home ? await savePicture(home, bytes, mime, item.type === 'prop' ? 'props' : item.type === 'role' ? 'characters' : 'scenes', item.name || itemId, { source: 'import', projectId, episodeId, itemId }) : { localPath: url }
  const items = assets.items.map(entry => entry.id === itemId ? pictureRecord({ ...entry, ...reference }) : entry)
  return { ...assets, items }
}

export async function saveCharacterReference({ assets, itemId, projectId, episodeId, directory, bytes, mime }) {
  const ext = stillExt[mime]
  if (!ext) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP'), { status: 400 })
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 400 })
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || item.type !== 'role') throw Object.assign(new Error('只有人物可以设置参考图'), { status: 400 })
  await replaceStill(directory, `${itemId}-ref`, ext, bytes)
  const reference = { localPath: assetImageUrl(projectId, `${itemId}-ref`, Date.now(), episodeId), mime }
  return { ...assets, items: assets.items.map(entry => entry.id === itemId ? { ...entry, reference } : entry) }
}

export function visualPlace(project, itemId) {
  if ((project.plot.characters?.items || []).some(item => item.id === itemId)) return { key: 'characters', bag: project.plot.characters }
  if ((project.plot.scenes?.items || []).some(item => item.id === itemId)) return { key: 'scenes', bag: project.plot.scenes }
  if ((project.plot.props?.items || []).some(item => item.id === itemId)) return { key: 'props', bag: project.plot.props }
  return null
}

export async function startImage(operation, project, { projects, models, home, submitAssetImage, defer }) {
  const place = visualPlace(project, operation.itemId)
  if (!place) throw Object.assign(new Error('请先写好角色卡或场景卡'), { status: 409 })
  const item = place.bag.items.find(entry => entry.id === operation.itemId)
  if (!item || !['role', 'scene', 'prop'].includes(item.type)) throw Object.assign(new Error('只有角色、场景和道具可以出图'), { status: 400 })
  await projects.save(project.id, { activity: `image:${item.id}`, activityError: null })
  const route = modelRoutes(await models.read())
  const bag = place.bag
  let how = '沿用这张卡已有的中文画面提示词'
  const imageModification = operation.generationMode === 'modify'
  if (!imageModification && !(item.type === 'prop' ? item.description?.trim() : usableLook(item.look))) {
    throw Object.assign(new Error('这张卡还没有可用的中文画面提示词'), { status: 400 })
  }
  const current = bag.items.find(entry => entry.id === item.id)
  const size = current.type === 'role' ? characterImageSize(operation.aspect) : gatewayImageSize(operation.aspect || aspectRatioOf(project.aspectRatio))
  const [width, height] = size.split('x').map(Number)
  const canvas = { width, height }
  const subject = current.type === 'prop' ? '道具' : current.type === 'role' ? '人物' : '场景'
  let submitted = imageModification ? '' : current.type === 'prop' ? propImagePrompt(current, project) : current.type === 'role' ? characterImagePrompt(current, project, undefined, { canvas }) : sceneImagePrompt(current, project, undefined, { canvas })
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  let referenceBytes
  let referenceMime
  let referenceBase64
  let reference = '纯文字生图'
  if (imageModification) {
    const instruction = String(operation.instruction || operation.review || checkContext.getStore()?.review || '').trim()
    if (!instruction) throw Object.assign(new Error(`${subject}图修改需要输入意见`), { status: 400 })
    const candidate = checkContext.getStore()?.originalCandidate
    let file
    if (candidate) {
      file = await readImageDraft(home, candidate.draftId)
      if (file.metadata.projectId !== project.id || file.metadata.episodeId !== project.episodeId || file.metadata.itemId !== item.id) throw Object.assign(new Error('修改原图不属于当前素材或剧集'), { status: 409 })
      referenceMime = file.metadata.mime
    } else {
      try { file = await readPicture(home, project, current) }
      catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error(`${subject}图修改需要原图，请先生成或导入图片`), { status: 400 })
        throw error
      }
      referenceMime = file.mime
    }
    referenceBytes = file.bytes
    if (!referenceBytes?.length) throw Object.assign(new Error(`${subject}图修改原图为空`), { status: 400 })
    if (current.type === 'prop') {
      submitted = propImagePrompt(current, project, instruction)
      referenceBase64 = [`data:${referenceMime};base64,${referenceBytes.toString('base64')}`]
    } else {
    const buildModel = current.type === 'role' ? characterImageModificationModel : sceneImageModificationModel
    const model = buildModel(current, project, { canvas, images: [{ purpose: 'edit-base', base64: `data:${referenceMime};base64,${referenceBytes.toString('base64')}` }], instruction })
    submitted = model.toPrompt()
    referenceBase64 = model.images.map(image => image.base64)
    }
    how = `按人工意见直接编辑${subject}原图`
    reference = '使用待修改原图，保留未涉及内容'
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
    referenceMime = file.mime
    const model = characterImageGenerationModel(current, project, { canvas, images: [{ purpose: 'character-reference', base64: `data:${referenceMime};base64,${referenceBytes.toString('base64')}` }] })
    submitted = model.toPrompt()
    referenceBase64 = model.images.map(image => image.base64)
    reference = '按参考图生成'
  }
  const seed = imageSeed(`${item.id}:${Date.now()}`)
  defer(submitAssetImage({
    assets: bag, itemId: item.id, aspectRatio: size, backend: route.image,
    projectId: project.id, episodeId: project.episodeId, directory, referenceBytes: referenceBase64 ? undefined : referenceBytes, referenceMime, referenceBase64, seed, home, prompt: submitted,
    stepTarget: `image:${item.id}`,
    onSaved: async next => {
      const draft = next.items.find(entry => entry.id === item.id).pendingImage
      await stageImageDraft(projects, project, draft, { key: place.key, itemId: item.id, name: item.name, target: pictureTargetSnapshot(item), aspect: operation.aspect || (current.type === 'role' ? '9:16' : size), useReference: Boolean(operation.useReference) })
    },
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

export async function stageImageDraft(projects, project, draft, target) {
  if (!draft?.draftId) throw new Error('生成结果缺少待确认图片')
  await projects.save(project.id, current => {
    const key = feedbackKey({ action: target.track ? 'pencil' : target.slot ? 'part-image' : 'image', track: target.track, itemId: target.itemId, slot: target.slot })
    consumeReview(targetNode(current, key))
    return { ...current, pendingImages: { ...current.pendingImages, [draft.draftId]: { ...draft, ...target } }, activity: null, activityError: null }
  })
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
  const reference = await savePicture(home, file.bytes, file.metadata.mime, file.metadata.category, file.metadata.name, file.metadata)
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
  note('图片已确认：已入素材库并更新关联')
  return trace
}

// if (operation.action === 'image' || operation.action === 'revise-image')
async function opImage(c) {
  let { operation, deps, home, projects, models, project } = c
  const lines = await startImage(operation, project, { projects, models, home, submitAssetImage: deps.submitAssetImage || submitAssetImage, defer: deps.defer })
  return lines
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
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  const bag = await importAssetImage({
    assets: place.bag, itemId: operation.itemId, projectId: project.id, episodeId: project.episodeId, directory,
    bytes, mime, home,
  })
  await projects.save(project.id, { ...staleMedia(project), ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  const item = bag.items.find(entry => entry.id === operation.itemId)
  note(`已用上传的文件替换 ${item?.id || operation.itemId} ${item?.name || ''}`.trim())
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
  const reference = await savePicture(home, bytes, mime, 'props', `${character.name}-${slot}`, { source: 'import', projectId: project.id, episodeId: project.episodeId, itemId: partId })
  const bag = appendImageAsset(place.bag, character.id, slot, {
    id: partId,
    name: `${partSlots[slot].label}${partId.slice(-2)}`,
    ...reference,
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
  await projects.save(project.id, { activity: `pencil:${track}`, activityError: null })
  const base = pencilPrompt(item)
  const source = imageSkillPrompt('pencil', review ? `${base}\n审核意见：${review}` : base, project)
  const route = modelRoutes(await models.read())
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'boards', project.episodeId || '')
  const seed = imageSeed(`${project.id}:${track}:${Date.now()}`)
  await (deps.submitPencilBoard || submitPencilBoard)({
    directory, track, prompt: source, aspectRatio: '1344x768', backend: route.image, seed, home, projectId: project.id, episodeId: project.episodeId,
    stepTarget: `pencil:${track}`,
    onSaved: reference => stageImageDraft(projects, project, reference, { track, name: `${track} 铅笔分镜`, target: pictureTargetSnapshot(item) }),
  })
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
  'import-image': { stage: 'episode', run: opImportImage },
  'set-reference': { stage: 'episode', run: opSetReference },
  'clear-reference': { stage: 'episode', run: opClearReference },
  'use-asset': { stage: 'episode', run: opUseAsset },
  'clear-image': { stage: 'episode', run: opClearImage },
  'part-import': { stage: 'episode', run: opPartImport },
  'part-text': { stage: 'episode', run: opPartText },
  'pencil': { stage: 'episode', run: opPencil },
}
