// 操作：确认 / 放弃候选图片
import { targetNode } from '../../../../shared/drama-model.js'
import { applyImageDraft, removeDraftPictures } from '../../../data/image-storage.js'
import { feedbackKey } from '../../../../shared/review-feedback.js'
import { markFailed } from '../../../../shared/content-state.js'

// if (operation.action === 'confirm-image' || operation.action === 'discard-image')
export async function opConfirmImage(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  if (!deps.imageReviewAllowed) throw Object.assign(new Error('请在图片预览中点击确认或放弃'), { status: 403 })
  const draft = project.pendingImages?.[operation.draftId]
  if (!draft) throw Object.assign(new Error('图片已处理或已失效，请刷新'), { status: 409 })
  if (draft.slot) throw Object.assign(new Error('人物部位图片已不再支持'), { status: 400 })
  const targetKey = feedbackKey({ action: 'image', track: draft.track, itemId: draft.itemId })
  const pendingImages = { ...project.pendingImages }
  delete pendingImages[draft.draftId]
  if (operation.action === 'discard-image') {
    await projects.save(project.id, current => { const next = structuredClone(current); next.pendingImages = pendingImages; const target = targetNode(next, targetKey); if (target) markFailed(target, '已放弃候选图片'); return next })
    await removeDraftPictures(home, draft)
    note('已放弃生成图片，原图保持不变')
    return trace
  }
  await applyImageDraft(home, projects, project, draft, deps.signal)
  note('图片已确认：已入素材库并更新关联')
  return trace
}

export const operations = {
  'confirm-image': { label: '确认使用图片', scope: 'episode', linkedCard: true, agent: false, step: (op, project) => { const draft = project?.pendingImages?.[op.draftId]; return { kind: 'confirm', target: draft ? `image:${draft.itemId}` : null } }, stage: 'review', run: opConfirmImage },
  'discard-image': { label: '放弃候选图片', scope: 'episode', linkedCard: true, agent: false, step: (op, project) => { const draft = project?.pendingImages?.[op.draftId]; return { kind: 'confirm', target: draft ? `image:${draft.itemId}` : null } }, stage: 'review', run: opConfirmImage },
}
