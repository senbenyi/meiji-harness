// 操作：确认 / 放弃候选图片
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { GenerationStatus } from '../../../../shared/drama-model.js'
import { plotPatch, targetNode } from '../../../../shared/drama-model.js'
import { shotResults, finish } from '../../../../shared/drama-model.js'
import { savePicture, pictureTargetSnapshot, readImageDraft } from '../../../data/image-storage.js'
import { pictureRecord, appendImageAsset, nextPartId } from '../../../../shared/image-assets.js'
import { staleMedia } from '../../../../shared/project-rules.js'
import { updateShotResult } from '../../../../shared/drama-model.js'
import { feedbackKey } from '../../../../shared/review-feedback.js'
import { markFailed } from '../../../../shared/content-state.js'

// if (operation.action === 'confirm-image' || operation.action === 'discard-image')
export async function opConfirmImage(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  if (!deps.imageReviewAllowed) throw Object.assign(new Error('请在图片预览中点击确认或放弃'), { status: 403 })
  const draft = project.pendingImages?.[operation.draftId]
  if (!draft) throw Object.assign(new Error('图片已处理或已失效，请刷新'), { status: 409 })
  const targetKey = feedbackKey({ action: draft.track ? 'pencil' : draft.slot ? 'part-image' : 'image', track: draft.track, itemId: draft.itemId, slot: draft.slot })
  const pendingImages = { ...project.pendingImages }
  delete pendingImages[draft.draftId]
  if (operation.action === 'discard-image') {
    await projects.save(project.id, current => { const next = structuredClone(current); next.pendingImages = pendingImages; const target = targetNode(next, targetKey); if (target) markFailed(target, '已放弃候选图片'); return next })
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
  const reference = await savePicture(home, file.bytes, file.metadata.mime, file.metadata.category, file.metadata.name, file.metadata)
  reference.prompt = file.metadata.prompt || ''
  let patch
  if (draft.track) patch = updateShotResult(project, 'pencil', draft.track, { ...reference, url: reference.localPath })
  else if (draft.slot) patch = { ...staleMedia(project), ...plotPatch(project, { [draft.key]: appendImageAsset(project.plot[draft.key], draft.itemId, draft.slot, { id: nextPartId(target, draft.slot), name: draft.name, ...reference }) }) }
  else patch = { ...staleMedia(project), ...plotPatch(project, { [draft.key]: { ...project.plot[draft.key], items: project.plot[draft.key].items.map(item => item.id === draft.itemId ? pictureRecord({ ...item, ...reference }) : item) } }) }
  try { await projects.save(project.id, current => { const next = { ...current, ...patch, pendingImages }; finish(targetNode(next, targetKey), { passed: true, failures: [] }); return next }) }
  catch (error) {
    await rm(join(home, 'storages', 'meiji', 'assets', reference.assetCategory, reference.assetId), { recursive: true, force: true })
    throw error
  }
  await rm(file.directory, { recursive: true, force: true })
  note('图片已确认：已入素材库并更新关联')
  return trace
}

export const operations = {
  'confirm-image': { label: '确认使用图片', scope: 'episode', queue: 'text', agent: false, task: false, step: () => ({ kind: 'confirm', target: null }), stage: 'review', run: opConfirmImage },
  'discard-image': { label: '放弃候选图片', scope: 'episode', queue: 'text', agent: false, task: false, step: () => ({ kind: 'confirm', target: null }), stage: 'review', run: opConfirmImage },
}
