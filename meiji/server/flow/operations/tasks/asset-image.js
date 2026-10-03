// 任务：角色图 / 场景图 / 道具图（阶段 2 按类型拆为 character-image、scene-image、prop-image）
import { join } from 'node:path'
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { pictureTargetSnapshot, readImageDraft, readPicture } from '../../../data/image-storage.js'
import { characterImageSize, gatewayImageSize } from '../../../gateway/model-gateway.js'
import { readStill } from '../../../media/image-files.js'
import { usableLook } from '../../../../shared/image-assets.js'
import { propImagePrompt } from '../../../prompts/image-prompts.js'
import { characterImagePrompt, characterImageGenerationModel, characterImageModificationModel } from '../../../prompts/interfaces/character-image-interface.js'
import { sceneImagePrompt, sceneImageModificationModel } from '../../../prompts/interfaces/scene-image-interface.js'
import { aspectRatioOf } from '../../../../shared/project-rules.js'
import { imageSeed, submitAssetImage, visualPlace, stageImageDraft } from '../shared/image-files.js'
import { imagePlan } from '../plan-steps.js'

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

// if (operation.action === 'image' || operation.action === 'revise-image')
export async function opImage(c) {
  let { operation, deps, home, projects, models, project } = c
  const lines = await startImage(operation, project, { projects, models, home, submitAssetImage: deps.submitAssetImage || submitAssetImage, defer: deps.defer })
  return lines
}

export const operations = {
  image: { label: '生成图片', scope: 'episode', queue: 'image', agent: true, plan: imagePlan, stage: 'episode', run: opImage },
  'revise-image': { label: '按新需求重绘图片', scope: 'episode', queue: 'image', agent: true, plan: imagePlan, stage: 'episode', run: opImage },
}
