// 任务：镜头表（生成；按审核意见重写单镜）
import { runTextNodes } from '../text-workflow.js'
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { canGenerate } from '../../../../shared/generation-gates.js'
import { node } from '../../../../shared/drama-model.js'
import { referencedEntities } from '../../../../shared/entity-references.js'
import { promptsForShotTable, readShotSections } from '../../steps/step-generate-shot-table.js'
import { feedbackOf } from '../../../../shared/review-feedback.js'
import { clearShotDownstream } from '../../../../shared/project-rules.js'
import { gateMessage } from '../../../../shared/generation-gates.js'

export function body(shot) { return shot?.content || '' }

export async function generateShots(options) {
  const { project, persist } = options
  const original = checkContext.getStore()?.originalProject || project
  const timingFailures = text => {
    const items = readShotSections(text)
    referencedEntities(items.map(item => item.content).join('\n'), project)
    const total = items.reduce((sum, shot) => sum + shot.duration, 0)
    return Math.abs(total - project.durationSeconds) > 10 ? [`镜头总时长 ${total}s，与目标 ${project.durationSeconds}s 相差超过10秒`] : []
  }
  const normalize = (text, check, reviewText = '') => {
    const items = readShotSections(text).map(item => {
      const previous = original.shots?.items?.find(shot => shot.id === item.id && shot.duration === item.duration && body(shot) === item.content)
      return previous ? { ...previous, ...item, cast: previous.cast || [], scene: previous.scene || '' } : item
    })
    return { ...node('shots'), revision: project.shots.revision + 1, items, failedOutput: '', reviewText, format: 'text', check }
  }
  const result = await runTextNodes({ target: 'shots', prompts: promptsForShotTable(options), options, check: timingFailures, canPersist: text => Boolean(readShotSections(text)), retainFailedDraft: true, persist: persist && ((text, check) => persist(normalize(text, check))) })
  const shots = normalize(result.text, result.check, result.reviewText)
  const failures = shots.check.failures
  if (persist) {
    if (checkContext.getStore()) checkContext.getStore().validation = []
    await persist(shots)
  }
  if (checkContext.getStore()) checkContext.getStore().validation = failures
  return shots
}

export async function reviseShot(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const normalize = text => {
    const items = readShotSections(text, project.shots.items.indexOf(shot))
    if (items.length !== 1 || items[0].duration !== shot.duration) throw new Error(`单镜修订只能返回 ${shotId}，时长保持 ${shot.duration} 秒`)
    return items[0].content
  }
  const result = await runTextNodes({ target: 'shots', prompts: promptsForShotTable(options), options,
    check: text => { referencedEntities(normalize(text), project); return [] },
    persist: options.persist && ((text, check) => options.persist({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: normalize(text), check } : item), check })) })
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: normalize(result.text), check: result.check } : item), check: result.check }
}

// if (operation.action === 'shots')
export async function opShots(c) {
  let { operation, deps, projects, models, project, submittedReview, trace, note } = c
  if (!canGenerate(project, 'shots')) throw Object.assign(new Error(gateMessage(project, 'shots')), { status: 409 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots') })
  const review = String(operation.review || '').trim()
  note('按事件与空间连续性规划镜头表，每段不超过15秒')
  if (submittedReview) note(`审核意见：${submittedReview}`)
  const failures = feedbackOf(project, 'shots').check.failures
  if (failures.length) note(`自检未通过：${failures.join('；')}`)
  const shots = await (deps.generateShots || generateShots)({ route: (modelRoutes(await models.read())).story, project, review, fetchImpl: deps.fetchImpl, request: deps.request, persist: shots => projects.save(project.id, { shots }) })
  await projects.writeStep(project.id, 'shots', { shots }, { final: true })
  note(shots.check.passed ? `镜头表已通过自检，共 ${shots.items.length} 镜。` : `镜头表已写入，自检未通过：${shots.check.failures.join('；')}`)
  note('每秒指令需要在镜头表里单独生成')
  return trace
}

// if (operation.action === 'revise-shot')
export async function opReviseShot(c) {
  let { operation, projects, models, project, trace, note } = c
  const review = String(operation.review || '').trim()
  if (operation.generationMode === 'modify' && !review) throw Object.assign(new Error('请先写下这一镜的审核意见'), { status: 400 })
  const track = String(operation.track || '')
  const items = project.shots?.items || []
  if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  if (!canGenerate(project, 'shots')) throw Object.assign(new Error('请先写好场景卡，再改镜头'), { status: 409 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots', track) })
  note(`文件：server/flow/tasks/text/task-shot-table.js`)
  note('函数：reviseShot')
  note(`重写 ${track}`)
  note(`审核意见：${review}`)
  const shots = await reviseShot({
    route: (modelRoutes(await models.read())).story, shotId: track, review,
    project, persist: shots => projects.save(project.id, { shots }),
  })
  await projects.writeStep(project.id, 'shots', { shots }, { final: true })
  note(shots.check.passed ? `${track} 已重写，镜头表通过自检。` : `${track} 已重写，自检未通过：${shots.check.failures.join('；')}`)
  return trace
}


export const runShotTable = context => context.operation.track ? opReviseShot(context) : opShots(context)
