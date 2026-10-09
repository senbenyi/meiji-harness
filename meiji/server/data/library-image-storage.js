import { applyLibraryCard, libraryTarget } from '../../shared/library-rules.js'
import { cardModel, finish, setContent } from '../models/data/drama-model.js'
import { pictureTargetSnapshot, saveDraftPictures, removeDraftPictures, removePictureAssets } from './image-storage.js'

// 项目库的人工确认与提取后的自动入库使用同一份快照校验和原子保存。
export async function applyLibraryImageDraft(home, projects, project, draft, signal) {
  const type = draft.libraryKind === 'characters' ? 'role' : draft.libraryKind === 'scenes' ? 'scene' : 'prop'
  const validate = root => {
    const target = libraryTarget(root, draft.libraryKind, draft)
    const card = target && applyLibraryCard(root, draft.libraryKind, cardModel({ id: draft.variantId, type }), target)
    if (!card || pictureTargetSnapshot(card) !== draft.target) throw Object.assign(new Error('人物或变体资料已修改，请重新生成'), { status: 409 })
    return target.variant
  }
  validate(project)
  const reference = { ...await saveDraftPictures(home, draft, { projectId: project.id, itemId: draft.variantId }, signal), source: 'ai' }
  const discarded = new Map([[draft.draftId, draft]])
  try {
    signal?.throwIfAborted()
    await projects.save(project.id, root => {
      signal?.throwIfAborted()
      const variant = validate(root)
      setContent(variant.image, reference, { passed: true, failures: [] })
      finish(variant.image, { passed: true, failures: [] })
      for (const [id, pending] of Object.entries(root.pendingImages || {})) if (pending.libraryId === draft.libraryId && pending.variantId === draft.variantId) {
        discarded.set(id, pending); delete root.pendingImages[id]
      }
      return root
    })
  } catch (error) { await removePictureAssets(home, reference); throw error }
  for (const pending of discarded.values()) await removeDraftPictures(home, pending)
  return reference
}
