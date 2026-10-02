import { activeStep } from '../../runtime/task-context.js'
import { saveTaskDraft } from '../../data/content-records.js'
import { shotModel, node, setContent, shotResults, updateShotResults, finish } from '../../../shared/drama-model.js'
import { referencedEntities } from '../../../shared/entity-references.js'
import { runTextSteps, reviewStep, reviewContent } from '../../runtime/text-generation.js'
import { buildTablePrompts, buildSingleShotPrompts, buildAllSecondsPrompts, buildSecondsPrompts } from '../../prompts/shot-text-prompts.js'
import { checkContext } from '../../runtime/operation-context.js'
import { parseSecondsPartial } from '../../../shared/seconds-content.js'
import { scopedCheck, uniqueFeedback, feedbackOf } from '../../../shared/review-feedback.js'
import { secondsRevisionIds } from '../../prompts/seconds-feedback.js'
import { compileVideoPrompt } from '../../prompts/video-prompt-renderer.js'
import { h3PromptFailures } from '../../../shared/video-rules.js'
import { shotSecondsReady } from '../../../shared/shot-timing.js'
import { runStep } from '../../runtime/task-execution.js'
import { selectCheck } from '../../runtime/review-checks.js'
import { storyboardTextPatch } from '../../../shared/storyboard-edit.js'
import { modelRoutes } from '../../../models/model-config.js'
import { clearShotDownstream } from '../../../shared/project-rules.js'
import { canGenerate, gateMessage, hasShots } from '../../../shared/generation-gates.js'

async function retainSecondsResponse(text) {
  if (activeStep()) await saveTaskDraft('seconds-response', { text })
  return text
}

function body(shot) { return shot?.content || '' }

// 只读取片段标题中的传输元数据；剧情正文保持原文，不解析 JSON。
export function readShotSections(text, offset = 0) {
  const marks = [...text.matchAll(/^## S(\d+) \/ (\d+)s[ \t]*$/gm)]
  if (!marks.length || text.slice(0, marks[0].index).trim()) throw new Error('镜头表需按「## S01 / 12s」分段，标题前不要添加说明')
  return marks.map((mark, index) => {
    const id = `S${String(offset + index + 1).padStart(2, '0')}`
    const duration = Number(mark[2])
    const body = text.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? text.length).trim()
    if (Number(mark[1]) !== offset + index + 1 || duration < 1 || duration > 15 || !body) throw new Error(`${id} 的编号、1–15秒时长或正文不完整`)
    return shotModel({ id, duration, text: body, cast: [], scene: '', format: 'text' })
  })
}

export async function generateShots(options) {
  const { project, persist } = options
  const original = checkContext.getStore()?.originalProject || project
  const timingFailures = text => {
    referencedEntities(text, project)
    const total = readShotSections(text).reduce((sum, shot) => sum + shot.duration, 0)
    return Math.abs(total - project.durationSeconds) > 10 ? [`镜头总时长 ${total}s，与目标 ${project.durationSeconds}s 相差超过10秒`] : []
  }
  const normalize = (text, check, reviewText = '') => {
    const items = readShotSections(text).map(item => {
      const previous = original.shots?.items?.find(shot => shot.id === item.id && shot.duration === item.duration && body(shot) === item.content)
      return previous ? { ...previous, ...item, cast: previous.cast || [], scene: previous.scene || '' } : item
    })
    return { ...node('shots'), revision: project.shots.revision + 1, items, failedOutput: '', reviewText, format: 'text', check }
  }
  const result = await runTextSteps({ target: 'shots', prompts: buildTablePrompts(options), options, check: timingFailures, canPersist: text => Boolean(readShotSections(text)), retainFailedDraft: true, persist: persist && ((text, check) => persist(normalize(text, check))) })
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
  const result = await runTextSteps({ target: 'shots', prompts: buildSingleShotPrompts(options), options, check: text => { referencedEntities(text, project); return [] }, persist: options.persist && ((text, check) => options.persist({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: text, check } : item), check })) })
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: result.text, check: result.check } : item), check: result.check }
}

// Generate, review and revise the complete episode as one version.
export async function generateAllSeconds(options) {
  let { project } = options
  const ctx = checkContext.getStore()
  const upstream = { ...project, shots: { ...project.shots, items: project.shots.items.map(shot => ({ ...shot, seconds: { ...shot.seconds, content: null, check: { passed: null } } })) } }
  if (ctx) ctx.target = { action: 'seconds' }
  const prompts = buildAllSecondsPrompts(options, upstream)
  const revise = prompts.revision
  let base = null, affected = null, correctionError = ''
  prompts.revision = (text, verdict) => {
    try { base = JSON.parse(text) } catch { base = null }
    affected = base?.shots ? secondsRevisionIds(verdict, project.shots.items) : project.shots.items.map(s => s.id)
    if (!affected.length) affected = project.shots.items.map(s => s.id)
    return revise(text, verdict, { revisionShotIds: affected })
  }
  const complete = async (text, _message, requestOptions) => {
    await retainSecondsResponse(text)
    if (requestOptions.logStage !== '自动修订' || !base?.shots) return text
    let correction
    try { correction = JSON.parse(text) } catch { return text }
    if (!Array.isArray(correction.shots)) return text
    if (correction.shots.some(s => !affected.includes(s.shotId))) { correctionError = '修订包含本轮限定范围外的镜头'; return text }
    const merged = base.shots.filter(s => !affected.includes(s.shotId))
    return JSON.stringify({ shots: [...merged, ...correction.shots] })
  }
  // 镜头清单可匹配时全部保存；失败镜头也保留正文，审核状态决定是否可用于下游。
  const partial = text => parseSecondsPartial(text, project.shots.items, project)
  const result = await runTextSteps({ target: 'seconds', prompts, options, complete, check: text => { if (correctionError) throw new Error(correctionError); return Object.values(partial(text).failures) },
    canPersist: text => !correctionError && partial(text).sections.length > 0, retainFailedDraft: true,
    persist: async (text, check) => {
      const { sections, failures } = partial(text)
      const shots = { ...project.shots, seconds: setContent(structuredClone(project.shots.seconds), { version: 1, shots: sections }, check), items: project.shots.items.map((shot, i) => {
        const scoped = scopedCheck(check, shot.id)
        const failure = failures[shot.id]
        if (failure) {
          scoped.passed = false
          if (!scoped.failures.some(reason => reason.includes(failure))) scoped.failures = uniqueFeedback([...scoped.failures, failure])
        }
        return { ...shot, seconds: setContent(structuredClone(shot.seconds), sections[i], scoped) }
      }) }
      project = options.persist ? await options.persist(shots, 'draft') : { ...project, shots }
    },
  })
  if (!result.check.passed) throw Object.assign(new Error(`自检未通过：${result.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
  return project.shots
}

export async function generateShotSeconds(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  const parse = text => parseSecondsPartial(text, [shot], project)
  const patch = (text, check) => ({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: setContent(structuredClone(item.seconds), parse(text).sections[0], check) } : item) })
  const result = await runTextSteps({ target: 'seconds', prompts: buildSecondsPrompts(options), options, complete: retainSecondsResponse,
    check: text => Object.values(parse(text).failures), canPersist: text => parse(text).sections.length > 0, retainFailedDraft: true,
    persist: options.persist && ((text, check) => options.persist(patch(text, check))) })
  return patch(result.text, result.check)
}

export async function generateShotStoryboard(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot || !shotSecondsReady(shot) || shot.seconds.check.passed !== true || shot.seconds.stale) throw Object.assign(new Error('请先生成这一镜的每秒指令并通过自审'), { status: 409 })
  const item = await runStep('generate', () => {
    try { return compileVideoPrompt(project, shot) } catch (error) { return { invalid: error.message } }
  }, { target: `storyboard:${shotId}`, phase: 'reference-binding', label: '程序组装' })
  const result = await reviewStep({ target: `storyboard:${shotId}`, phase: 'reference-binding', text: item.prompt?.text || '',
    check: text => item.invalid ? [item.invalid] : h3PromptFailures(text, item.referenceSnapshot, item.video) })
  if (item.invalid) throw Object.assign(new Error(`自审未通过：${item.invalid}`), { code: 'CONTENT_CHECK_FAILED' })
  item.bindingCheck = result.check
  const byId = new Map(shotResults(project, 'storyboard').map(item => [item.id, item]))
  byId.set(shotId, { id: shotId, ...item })
  const rows = project.shots.items.map(shot => byId.get(shot.id)).filter(Boolean)
  if (options.persistDraft) await options.persistDraft(rows, result.check)
  if (result.check.passed !== true) throw Object.assign(new Error(`自审未通过：${result.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED' })
  return rows
}

export async function generateStoryboard(options) {
  let project = options.project
  for (const shot of project.shots.items) {
    if (options.beforeShot) project = await options.beforeShot(shot.id)
    await selectCheck(project, { action: 'shot-storyboard', track: shot.id })
    project = { ...project, ...updateShotResults(project, 'storyboard', await generateShotStoryboard({ ...options, project, shotId: shot.id, persistDraft: options.persist && ((rows) => options.persist(rows)) })) }
    if (options.persist) await options.persist(shotResults(project, 'storyboard'))
    if (checkContext.getStore()?.validation?.length) break
  }
  return shotResults(project, 'storyboard')
}

// if (operation.action === 'storyboard-text')
async function opStoryboardText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  project = await runStep('save', () => projects.save(project.id, current => ({ ...storyboardTextPatch(current, operation), activity: `shot-storyboard:${operation.track}` })), { target: `storyboard:${operation.track}` })
  const result = await (deps.reviewContent || reviewContent)({ project, stage: 'storyboard', shotId: operation.track, text: operation.text, route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, { activity: null })
  note(result.passed ? '文本分镜已保存并通过自检' : `文本分镜已保存，自检未通过：${result.failures.join('；')}`)
  return trace
}

// if (operation.action === 'shot-assets')
async function opShotAssets(c) {
  let { operation, projects, project, trace, note } = c
  const shot = project.shots?.items.find(item => item.id === operation.track)
  if (!shot) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  const cast = (project.plot.characters?.items || []).filter(item => operation.characterIds?.includes(item.id)).map(item => item.name)
  const scene = (project.plot.scenes?.items || []).find(item => item.id === operation.sceneId)?.name || ''
  const patch = clearShotDownstream(project, 'storyboard', shot.id)
  await projects.save(project.id, { ...patch, shots: { ...patch.shots, items: patch.shots.items.map(item => item.id === shot.id ? { ...item, cast, scene, reference_images: operation.referenceIds || [], storyboard: { ...item.storyboard, stale: Boolean(item.storyboard.content), check: { ...item.storyboard.check, passed: null, failures: [] } } } : item) }, activity: null })
  note(`${shot.id} 素材关联已保存，请重新生成文本分镜`)
  return trace
}

// if (operation.action === 'shots')
async function opShots(c) {
  let { operation, deps, projects, models, project, submittedReview, trace, note } = c
  if (!canGenerate(project, 'shots')) throw Object.assign(new Error(gateMessage(project, 'shots')), { status: 409 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots'), activity: 'shots', activityError: null })
  const review = String(operation.review || '').trim()
  note('按事件与空间连续性规划镜头表，每段不超过15秒')
  if (submittedReview) note(`审核意见：${submittedReview}`)
  const failures = feedbackOf(project, 'shots').check.failures
  if (failures.length) note(`自检未通过：${failures.join('；')}`)
  const shots = await (deps.generateShots || generateShots)({ route: (modelRoutes(await models.read())).story, project, review, persist: shots => projects.save(project.id, { shots }) })
  await projects.writeStep(project.id, 'shots', {
    shots,
    activity: null,
  })
  note(shots.check.passed ? `镜头表已通过自检，共 ${shots.items.length} 镜。` : `镜头表已写入，自检未通过：${shots.check.failures.join('；')}`)
  note('每秒指令需要在镜头表里单独生成')
  return trace
}

// if (operation.action === 'seconds')
async function opSeconds(c) {
  let { deps, projects, models, project, trace, note } = c
  const items = project.shots?.items || []
  if (!items.length) throw Object.assign(new Error('请先写好镜头表，再写每秒指令'), { status: 409 })
  project = await projects.save(project.id, { activity: 'seconds', activityError: null })
  note('整集一次生成每秒指令，整集独立自审')
  await (deps.generateAllSeconds || generateAllSeconds)({ route: (modelRoutes(await models.read())).story, project,
    persist: (shots, phase) => projects.save(project.id, current => {
      const patch = phase === 'draft' ? clearShotDownstream(current, 'seconds') : { shots: current.shots }
      patch.shots.seconds = shots.seconds
      patch.shots.items = patch.shots.items.map(shot => phase === 'draft' || shot.id === checkContext.getStore()?.target?.track ? { ...shot, seconds: shots.items.find(item => item.id === shot.id).seconds } : shot)
      return { ...patch, assembly: node('assembly'), activity: 'seconds' }
    }),
  })
  await projects.save(project.id, current => {
    const next = structuredClone(current)
    finish(next.shots.seconds, { passed: true, failures: [] })
    next.activity = null
    return next
  })
  note('每秒指令已写完')
  return trace
}

// if (operation.action === 'revise-shot')
async function opReviseShot(c) {
  let { operation, projects, models, project, trace, note } = c
  const review = String(operation.review || '').trim()
  if (operation.generationMode === 'modify' && !review) throw Object.assign(new Error('请先写下这一镜的审核意见'), { status: 400 })
  const track = String(operation.track || '')
  const items = project.shots?.items || []
  if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  if (!canGenerate(project, 'shots')) throw Object.assign(new Error('请先写好场景卡，再改镜头'), { status: 409 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'shots', track), activity: `revise-shot:${track}`, activityError: null })
  note(`文件：server/flow/operations/shot-operations.js`)
  note('函数：reviseShot')
  note(`重写 ${track}`)
  note(`审核意见：${review}`)
  const shots = await reviseShot({
    route: (modelRoutes(await models.read())).story, shotId: track, review,
    project, persist: shots => projects.save(project.id, { shots }),
  })
  await projects.writeStep(project.id, 'shots', { shots, activity: null })
  note(shots.check.passed ? `${track} 已重写，镜头表通过自检。` : `${track} 已重写，自检未通过：${shots.check.failures.join('；')}`)
  return trace
}

// if (operation.action === 'shot-seconds')
async function opShotSeconds(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const track = String(operation.track || '')
  const items = project.shots?.items || []
  if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  const review = String(operation.review || '').trim()
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'seconds', track), activity: `shot-seconds:${track}`, activityError: null })
  note('技能：每秒指令（skills/task/generate-seconds-instructions-skill.md）')
  note('函数：generateShotSeconds（server/flow/operations/shot-operations.js）')
  note(`写 ${track} 的每一秒`)
  if (review) note(`审核意见：${review}`)
  const shots = await (deps.generateShotSeconds || generateShotSeconds)({
    route: (modelRoutes(await models.read())).story, shotId: track, project, review,
    persist: shots => projects.save(project.id, { shots }),
  })
  await projects.save(project.id, { shots, activity: null })
  const row = shots.items.find(item => item.id === track)
  note(`${track} 已生成指令原文，目标时长 ${row?.duration || 0} 秒`)
  return trace
}

// if (operation.action === 'shot-storyboard')
async function opShotStoryboard(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  if (feedbackOf(project, `seconds:${operation.track}`).check.passed === false) throw Object.assign(new Error('这一镜每秒指令自检未通过，请先修正'), { status: 409 })
  const track = String(operation.track || '')
  if (!(project.shots?.items || []).some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  if (!shotSecondsReady(project.shots.items.find(item => item.id === track))) throw Object.assign(new Error('请先写好这一镜的每秒指令'), { status: 409 })
  const review = String(operation.review || '').trim()
  if (review || operation.generationMode === 'modify') throw Object.assign(new Error('视频提示词由程序组装；请在每秒分镜提交修改意见，或直接编辑最终提示词'), { status: 409 })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'storyboard', track), activity: `shot-storyboard:${track}`, activityError: null })
  note('步骤：每秒指令 → 多模态引用编排')
  note('函数：generateShotStoryboard（server/flow/operations/shot-operations.js）')
  note(`写 ${track} 的文本分镜。每秒指令原样进入面板，并检查身份、声音和参考图绑定`)
  if (review) note(`审核意见：${review}`)
  const storyboard = await (deps.generateShotStoryboard || generateShotStoryboard)({
    route: (modelRoutes(await models.read())).story, shotId: track, project, review,
    persistDraft: (rows, check) => projects.save(project.id, current => {
      const patch = updateShotResults(current, 'storyboard', rows)
      patch.shots.items.find(item => item.id === track).storyboard.check = check
      return patch
    }),
  })
  await projects.save(project.id, { ...updateShotResults(project, 'storyboard', storyboard), assembly: node('assembly'), activity: null })
  note(`${track} 的分镜已写入。这一镜的铅笔分镜和成片已清空`)
  return trace
}

// if (operation.action === 'shot-boards')
async function opShotBoards(c) {
  let { deps, projects, models, project, trace, note } = c
  const ids = (project.shots?.items || []).map(item => item.id)
  if (!ids.length) throw Object.assign(new Error('请先写好镜头表'), { status: 409 })
  project = await projects.save(project.id, { activity: 'shot-boards', activityError: null })
  note('按镜头顺序生成所有分镜')
  await (deps.generateAllSeconds || generateAllSeconds)({ route: (modelRoutes(await models.read())).story, project,
    persist: (shots, phase) => projects.save(project.id, current => {
      const patch = phase === 'draft' ? clearShotDownstream(current, 'seconds') : { shots: current.shots }
      patch.shots.seconds = shots.seconds
      patch.shots.items = patch.shots.items.map(shot => phase === 'draft' || shot.id === checkContext.getStore()?.target?.track ? { ...shot, seconds: shots.items.find(item => item.id === shot.id).seconds } : shot)
      return { ...patch, assembly: node('assembly'), activity: 'shot-boards' }
    }),
  })
  const writeBoard = deps.generateShotStoryboard || generateShotStoryboard
  for (const track of ids) {
    let current = await projects.read(project.id)
    note('技能：文本分镜（skills/task/generate-text-storyboard-skill.md）')
    note('函数：generateShotStoryboard（server/flow/operations/shot-operations.js）')
    note(`写 ${track} 的文本分镜。每秒指令原样进入面板，并检查身份、声音和参考图绑定`)
    await selectCheck(current, { action: 'shot-storyboard', track })
    const storyboard = await writeBoard({ route: (modelRoutes(await models.read())).story, shotId: track, project: current })
  await projects.save(project.id, { ...updateShotResults(current, 'storyboard', storyboard), assembly: node('assembly'), activity: 'shot-boards' })
    note(`${track} 的分镜已写入。这一镜的铅笔分镜和成片已清空`)
  }
  await projects.save(project.id, { activity: null })
  return trace
}

// if (operation.action === 'storyboard')
async function opStoryboard(c) {
  let { deps, projects, models, project, trace, note } = c
  if (!hasShots(project)) throw Object.assign(new Error('请先写好镜头表，再生成文本分镜'), { status: 409 })
  project = await projects.save(project.id, { activity: 'storyboard', activityError: null })
  const current = project
  if (current.shots.items.some(shot => !shotSecondsReady(shot) || shot.seconds.check.passed !== true || shot.seconds.stale)) throw Object.assign(new Error('请先生成整集每秒指令，并使每镜自审通过'), { status: 409 })
  await selectCheck(current, { action: 'storyboard' })
  note('按「文本分镜」技能生成全部分镜表，并审核原文剧情与素材关联')
  const storyboard = await (deps.generateStoryboard || generateStoryboard)({ route: (modelRoutes(await models.read())).story, project: current, beforeShot: track => projects.save(project.id, current => clearShotDownstream(current, 'storyboard', track)), persist: storyboard => projects.save(project.id, current => updateShotResults(current, 'storyboard', storyboard)) })
  await projects.writeStep(project.id, 'storyboard', { ...updateShotResults(await projects.read(project.id), 'storyboard', storyboard), activity: null })
  note(`文本分镜已写入，共 ${storyboard.length} 镜。铅笔分镜和成片已清空，等待重新生成`)
  return trace
}

export const shotOperations = {
  'storyboard-text': { stage: 'episode', run: opStoryboardText },
  'shot-assets': { stage: 'episode', run: opShotAssets },
  'shots': { stage: 'episode', run: opShots },
  'seconds': { stage: 'episode', run: opSeconds },
  'revise-shot': { stage: 'episode', run: opReviseShot },
  'shot-seconds': { stage: 'episode', run: opShotSeconds },
  'shot-storyboard': { stage: 'episode', run: opShotStoryboard },
  'storyboard-bind': { stage: 'episode', run: opShotStoryboard },
  'shot-boards': { stage: 'episode', run: opShotBoards },
  'storyboard': { stage: 'episode', run: opStoryboard },
}
