// 小任务：单镜每秒指令
import { runTextNodes } from '../text-workflow.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { setContent } from '../../../../shared/drama-model.js'
import { promptsForSeconds } from '../../steps/step-generate-seconds.js'
import { parseSecondsPartial } from '../../../../shared/seconds-content.js'
import { retainSecondsResponse, saveSecondsShot } from '../../shared/seconds-results.js'

export async function generateShotSeconds(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  const parse = text => parseSecondsPartial(text, [shot], project)
  const prompts = promptsForSeconds(options), review = prompts.review
  prompts.review = (text, revision) => {
    try { return review(JSON.stringify({ shots: parse(text).sections }), revision) }
    catch { return review(text, revision) }
  }
  const patch = (text, check) => ({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: setContent(structuredClone(item.seconds), parse(text).sections[0], check) } : item) })
  const result = await runTextNodes({ target: `seconds:${shotId}`, prompts, options, complete: retainSecondsResponse,
    check: text => Object.values(parse(text).failures), canPersist: text => parse(text).sections.length > 0, retainFailedDraft: true,
    persist: options.persist && ((text, check) => options.persist(patch(text, check))) })
  return patch(result.text, result.check)
}

// if (operation.action === 'shot-seconds')
export async function opShotSeconds(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const track = String(operation.track || '')
  const items = project.shots?.items || []
  if (!items.some(item => item.id === track)) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  const review = String(operation.review || '').trim()
  note('技能：每秒指令（skills/task/generate-seconds-instructions-skill.md）')
  note('函数：generateShotSeconds（server/flow/tasks/text/task-shot-seconds.js）')
  note(`写 ${track} 的每一秒`)
  if (review) note(`审核意见：${review}`)
  const shots = await (deps.generateShotSeconds || generateShotSeconds)({
    route: (modelRoutes(await models.read())).story, shotId: track, project, review, fetchImpl: deps.fetchImpl, request: deps.request,
    persist: shots => projects.save(project.id, current => saveSecondsShot(current, shots, track)),
  })
  await projects.save(project.id, current => saveSecondsShot(current, shots, track), { final: true })
  const row = shots.items.find(item => item.id === track)
  if (row?.seconds.check.passed === false) throw Object.assign(new Error(`自审未通过：${row.seconds.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
  note(`${track} 已生成指令原文，目标时长 ${row?.duration || 0} 秒`)
  return trace
}
