// 共享函数：任务与操作共用
import { readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { checkContext } from '../../../runtime/operation-context.js'
import { consumeReview } from '../../../../shared/drama-model.js'
import { runNode } from '../../../runtime/task-execution.js'
import { targetNode } from '../../../../shared/drama-model.js'
import { createHash } from 'node:crypto'
import { saveImageDraft, savePicture } from '../../../data/image-storage.js'
import { generateGatewayImage } from '../../../gateway/model-gateway.js'
import { replaceStill, stillExt } from '../../../media/image-files.js'
import { assetImageUrl, imagePrompt, pictureRecord } from '../../../../shared/image-assets.js'
import { limitStillBytes } from '../../../media/compress-image.js'
import { feedbackKey } from '../../../../shared/review-feedback.js'
import { decodeImageData } from '../../../media/decode-image-data.js'
import { openIncoming } from './incoming.js'

export function imageSeed(id) {
  return createHash('sha256').update(String(id)).digest().readUInt32BE(0)
}

export const imageStep = (target, kind, run) => target ? runNode(kind, run, { target }) : run()

export async function saveGeneratedImage(target, run, onSaved, signal) {
  return imageStep(target, 'image_save', async () => {
    signal ??= checkContext.getStore()?.signal
    signal?.throwIfAborted()
    const result = await run()
    signal?.throwIfAborted()
    if (onSaved) await onSaved(result)
    return result
  })
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

export async function stageImageDraft(projects, project, draft, target) {
  if (!draft?.draftId) throw new Error('生成结果缺少待确认图片')
  await projects.save(project.id, current => {
    const key = feedbackKey({ action: target.slot ? 'part-image' : 'image', track: target.track, itemId: target.itemId, slot: target.slot })
    consumeReview(targetNode(current, key))
    return { ...current, pendingImages: { ...current.pendingImages, [draft.draftId]: { ...draft, ...target } }}
  }, { final: true })
}

export async function readUploadedImage(operation, home) {
  if (operation.data) return decodeImageData(operation.data, operation.mime)
  const incoming = await openIncoming(home, operation.incomingId)
  const bytes = await readFile(incoming.file)
  const mime = incoming.mime
  await rm(incoming.directory, { recursive: true, force: true })
  return { bytes, mime }
}
