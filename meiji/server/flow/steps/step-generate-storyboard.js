import { resolveStoryboardProject } from '../../../shared/storyboard-characters.js'
// 小任务：分镜文本提示词
import { checkContext } from '../../runtime/operation-context.js'
import { runNode } from '../../runtime/step-execution.js'
import { node, shotResults, updateShotResults } from '../../../shared/drama-model.js'
import { feedbackOf } from '../../../shared/review-feedback.js'
import { compileVideoPrompt } from '../../prompts/video-prompt-renderer.js'
import { h3PromptFailures } from '../../../shared/video-rules.js'
import { shotSecondsReady } from '../../../shared/shot-timing.js'
import { selectCheck } from '../../runtime/review-checks.js'
import { clearShotDownstream } from '../../../shared/project-rules.js'
import { hasShots } from '../../../shared/generation-gates.js'

export async function generateShotStoryboard(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot || !shotSecondsReady(shot) || shot.seconds.check.passed !== true) throw Object.assign(new Error('请先生成这一镜的每秒指令并通过自审'), { status: 409 })
  const resolved = await runNode('check', () => resolveStoryboardProject(project, shot, { requireParticipants: true }), { target: `storyboard:${shotId}`, phase: 'character-binding', label: '匹配参与角色与既有资料' })
  const item = await runNode('generate', () => {
    try { return compileVideoPrompt(resolved, shot) } catch (error) { return { invalid: error.message } }
  }, { target: `storyboard:${shotId}`, phase: 'reference-binding', label: '编排分镜提示词' })
  const result = await runNode('check', () => {
    const failures = item.invalid ? [item.invalid] : h3PromptFailures(item.prompt.text, item.referenceSnapshot, item.video)
    return { check: { passed: failures.length === 0, failures } }
  }, { target: `storyboard:${shotId}`, phase: 'reference-binding', label: '校验分镜提示词' })
  if (item.invalid) throw Object.assign(new Error(`校验未通过：${item.invalid}`), { code: 'CONTENT_CHECK_FAILED' })
  item.bindingCheck = result.check
  const byId = new Map(shotResults(project, 'storyboard').map(item => [item.id, item]))
  byId.set(shotId, { id: shotId, ...item })
  const rows = project.shots.items.map(shot => byId.get(shot.id)).filter(Boolean)
  if (options.persistDraft) await options.persistDraft(rows, result.check)
  if (result.check.passed !== true) throw Object.assign(new Error(`校验未通过：${result.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED' })
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

// if (operation.action === 'shot-storyboard')
export async function opShotStoryboard(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  if (feedbackOf(project, `seconds:${operation.track}`).check.passed === false) throw Object.assign(new Error('这一镜每秒指令自检未通过，请先修正'), { status: 409 })
  const track = String(operation.track || '')
  if (!(project.shots?.items || []).some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  if (!shotSecondsReady(project.shots.items.find(item => item.id === track))) throw Object.assign(new Error('请先写好这一镜的每秒指令'), { status: 409 })
  const review = String(operation.review || '').trim()
  if (review || operation.generationMode === 'modify') throw Object.assign(new Error('视频提示词由程序组装；请在每秒分镜提交修改意见，或直接编辑最终提示词'), { status: 409 })
  // 缺清单、角色或歧义在替换已有提示词前报告，不触发任何角色生成。
  resolveStoryboardProject(project, project.shots.items.find(item => item.id === track), { requireParticipants: true })
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'storyboard', track) })
  note('步骤：每秒指令 → 多模态引用编排')
  note('函数：generateShotStoryboard（server/flow/steps/step-generate-storyboard.js）')
  note(`写 ${track} 的文本分镜。每秒指令原样进入面板，并检查身份、声音和参考图绑定`)
  if (review) note(`审核意见：${review}`)
  const storyboard = await (deps.generateShotStoryboard || generateShotStoryboard)({
    shotId: track, project, review,
    persistDraft: (rows, check) => projects.save(project.id, current => {
      const patch = updateShotResults(current, 'storyboard', rows)
      patch.shots.items.find(item => item.id === track).storyboard.check = check
      return patch
    }),
  })
  await projects.save(project.id, { ...updateShotResults(project, 'storyboard', storyboard), assembly: node('assembly') }, { final: true })
  note(`${track} 的分镜已写入。这一镜的成片已清空`)
  return trace
}

// if (operation.action === 'storyboard')
export async function opStoryboard(c) {
  let { deps, projects, models, project, trace, note } = c
  if (!hasShots(project)) throw Object.assign(new Error('请先写好镜头表，再生成文本分镜'), { status: 409 })
  project = await projects.read(project.id)
  const current = project
  if (current.shots.items.some(shot => !shotSecondsReady(shot) || shot.seconds.check.passed !== true)) throw Object.assign(new Error('请先生成整集每秒指令，并使每镜自审通过'), { status: 409 })
  await selectCheck(current, { action: 'storyboard' })
  note('程序编排全部分镜提示词，并校验原文剧情与素材关联')
  const storyboard = await (deps.generateStoryboard || generateStoryboard)({ project: current, beforeShot: track => projects.save(project.id, current => clearShotDownstream(current, 'storyboard', track)), persist: storyboard => projects.save(project.id, current => updateShotResults(current, 'storyboard', storyboard)) })
  await projects.writeStep(project.id, 'storyboard', { ...updateShotResults(await projects.read(project.id), 'storyboard', storyboard) }, { final: true })
  note(`文本分镜已写入，共 ${storyboard.length} 镜。成片已清空，等待重新生成`)
  return trace
}
