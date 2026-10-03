// 任务：每秒指令（整集，逐镜生成与审核）
import { modelRoutes } from '../../../../models/model-config.js'
import { finish } from '../../../../shared/drama-model.js'
import { selectCheck } from '../../../runtime/review-checks.js'
import { saveSecondsShot } from '../shared/seconds-results.js'
import { generateShotSeconds } from './shot-seconds.js'
import { textSteps, shotIds } from '../plan-steps.js'

// 每镜通过后才生成下一镜，后镜读取本轮前镜最终稿。
export async function generateAllSeconds(options) {
  let project = options.project
  for (const { id } of project.shots.items) {
    options.signal?.throwIfAborted()
    await selectCheck(project, { action: 'shot-seconds', track: id })
    const shots = await generateShotSeconds({ ...options, project, shotId: id,
      persist: async shots => {
        project = options.persist ? await options.persist(shots, id) : { ...project, shots }
      },
    })
    const check = shots.items.find(shot => shot.id === id).seconds.check
    if (!check.passed) throw Object.assign(new Error(`自检未通过：${check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
    // 在文本步骤之外结束本镜状态，仍属于同一个外层任务。
    project = options.persist ? await options.persist(project.shots, id) : project
  }
  return project.shots
}

// if (operation.action === 'seconds')
export async function opSeconds(c) {
  let { deps, projects, models, project, trace, note } = c
  const items = project.shots?.items || []
  if (!items.length) throw Object.assign(new Error('请先写好镜头表，再写每秒指令'), { status: 409 })
  project = await projects.read(project.id)
  note('按镜头顺序逐镜生成每秒指令，每镜自审通过后继续下一镜')
  await (deps.generateAllSeconds || generateAllSeconds)({ route: (modelRoutes(await models.read())).story, project,
    persist: (shots, track) => projects.save(project.id, current => {
      const patch = saveSecondsShot(current, shots, track)
      return patch
    }),
  })
  await projects.save(project.id, current => {
    const next = structuredClone(current)
    finish(next.shots.seconds, { passed: true, failures: [] })
    return next
  }, { final: true })
  note('每秒指令已写完')
  return trace
}

export const operations = {
  seconds: { label: '生成每秒指令', maxRevisions: 2, scope: 'episode', queue: 'text', agent: true, plan: project => shotIds(project).flatMap(id => textSteps(`seconds:${id}`)), stage: 'episode', run: opSeconds },
}
