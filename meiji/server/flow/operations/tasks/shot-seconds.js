// 小任务：单镜每秒指令
import { runTextSteps } from '../../../runtime/text-generation.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { setContent } from '../../../../shared/drama-model.js'
import { buildSecondsPrompts } from '../../../prompts/shot-text-prompts.js'
import { parseSecondsPartial } from '../../../../shared/seconds-content.js'
import { clearShotDownstream } from '../../../../shared/project-rules.js'
import { retainSecondsResponse } from '../shared/seconds-results.js'
import { textSteps } from '../plan-steps.js'

export async function generateShotSeconds(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  const parse = text => parseSecondsPartial(text, [shot], project)
  const patch = (text, check) => ({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: setContent(structuredClone(item.seconds), parse(text).sections[0], check) } : item) })
  const result = await runTextSteps({ target: `seconds:${shotId}`, prompts: buildSecondsPrompts(options), options, complete: retainSecondsResponse,
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
  project = await projects.save(project.id, { ...clearShotDownstream(project, 'seconds', track), activity: `shot-seconds:${track}`, activityError: null })
  note('技能：每秒指令（skills/task/generate-seconds-instructions-skill.md）')
  note('函数：generateShotSeconds（server/flow/operations/tasks/shot-seconds.js）')
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

export const operations = {
  'shot-seconds': { label: '生成每秒指令', scope: 'shot', queue: 'text', agent: true, plan: (_, op) => textSteps(`seconds:${op.track}`), stage: 'episode', run: opShotSeconds },
}
