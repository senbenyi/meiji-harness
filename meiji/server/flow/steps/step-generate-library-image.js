import { join } from 'node:path'
import { libraryTarget, applyLibraryCard } from '../../../shared/library-rules.js'
import { begin, node, cardModel } from '../../../shared/drama-model.js'
import { markFailed } from '../../../shared/content-state.js'
import { modelRoutes } from '../../../models/model-config.js'
import { submitAssetImage, imageSeed } from './shared/image-files.js'
import { characterImagePrompt } from '../../prompts/interfaces/character-image-interface.js'
import { sceneImagePrompt } from '../../prompts/interfaces/scene-image-interface.js'
import { propImagePrompt } from '../../prompts/image-prompts.js'
import { gatewayImageSize } from '../../gateway/model-gateway.js'
import { pictureTargetSnapshot } from '../../data/image-storage.js'

export async function runLibraryImage(c) {
  const { operation: op, project, projects, deps } = c, target = libraryTarget(project, op.libraryKind, { libraryId: op.libraryId, variantId: op.variantId })
  if (!target) throw Object.assign(new Error('库变体不存在'), { status: 404 })
  if (Object.values(project.pendingImages || {}).some(draft => draft.variantId === op.variantId)) throw Object.assign(new Error('请先处理该变体的候选图'), { status: 409 })
  const type = op.libraryKind === 'characters' ? 'role' : op.libraryKind === 'scenes' ? 'scene' : 'prop'
  const card = applyLibraryCard(project, op.libraryKind, cardModel({ id: op.variantId, type }), target)
  const size = gatewayImageSize(project.aspectRatio), [width, height] = size.split('x').map(Number)
  const prompt = type === 'role' ? characterImagePrompt(card, project, undefined, { canvas: { width, height } }) : type === 'scene' ? sceneImagePrompt(card, project, undefined, { canvas: { width, height } }) : propImagePrompt(card, project)
  await projects.save(project.id, root => { begin(libraryTarget(root, op.libraryKind, op).variant.image, { id: deps.taskId }); return root })
  try {
    const bag = await (deps.submitAssetImage || submitAssetImage)({ assets: { items: [card] }, itemId: card.id, aspectRatio: size, backend: modelRoutes(await c.models.read()).image, projectId: project.id, home: c.home, directory: join(c.home, 'storages', 'meiji', 'projects', project.id, 'images'), prompt, seed: imageSeed(`${card.id}:${Date.now()}`), fetchImpl: deps.fetchImpl, signal: deps.signal, stepTarget: `image:${card.id}` })
    const draft = bag.items[0].pendingImage
    if (!draft?.draftId) throw new Error('生成结果缺少候选图片')
    await projects.save(project.id, root => {
      root.pendingImages = { ...root.pendingImages, [draft.draftId]: { ...draft, libraryKind: op.libraryKind, libraryId: op.libraryId, variantId: op.variantId, target: pictureTargetSnapshot(card) } }
      libraryTarget(root, op.libraryKind, op).variant.image.operation.phase = 'awaiting-confirmation'; return root
    })
    c.trace.result = { pendingConfirm: true }; c.note('库图片已生成，等待确认'); return c.trace
  } catch (error) {
    await projects.save(project.id, root => { markFailed(libraryTarget(root, op.libraryKind, op).variant.image, error.message); return root }).catch(() => {})
    throw error
  }
}
