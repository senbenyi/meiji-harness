// 任务：铅笔分镜图（用户已决定取消，阶段 2 删除）
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { modelRoutes } from '../../../../models/model-config.js'
import { shotResults } from '../../../../shared/drama-model.js'
import { saveImageDraft, pictureTargetSnapshot } from '../../../data/image-storage.js'
import { generateGatewayImage } from '../../../gateway/model-gateway.js'
import { replaceStill } from '../../../media/image-files.js'
import { imageSkillPrompt, pencilPrompt } from '../../../prompts/image-prompts.js'
import { imageSeed, saveGeneratedImage, stageImageDraft } from '../shared/image-files.js'
import { imageSteps } from '../plan-steps.js'

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

// if (operation.action === 'pencil')
export async function opPencil(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  const track = String(operation.track || '')
  const item = shotResults(project, 'storyboard').find(entry => entry.id === track)
  if (!(item?.format === 'text' ? item.prompt?.text : item?.panels?.length) || !/^S[0-9]{2,}$/.test(track)) throw Object.assign(new Error('请先写好这一镜的文本分镜'), { status: 409 })
  const review = String(operation.review || '').trim()
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

export const operations = {
  pencil: { label: '生成铅笔分镜', maxRevisions: 0, scope: 'shot', queue: 'image', agent: true, plan: (_, op) => imageSteps(`pencil:${op.track}`), stage: 'episode', run: opPencil },
}
