// 任务：每秒指令（整集，逐镜生成与审核）
import { modelRoutes } from '../../models/model-config.js'
import { finish } from '../../server/models/data/drama-model.js'
import { selectCheck } from '../../server/runtime/review-checks.js'
import { saveSecondsShot } from '../../server/flow/shared/seconds-results.js'
import { generateShotSeconds } from '../../server/flow/tasks/text/task-shot-seconds.js'

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
