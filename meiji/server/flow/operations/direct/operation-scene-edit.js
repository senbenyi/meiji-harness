import { editLinkedCard } from '../../../../shared/library-rules.js'
// 操作：编辑场景文字
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { runNode } from '../../../runtime/task-execution.js'
import { reviewContent } from '../../../runtime/text-generation.js'
import { plotPatch } from '../../../../shared/drama-model.js'
import { editSteps } from '../../../../shared/task-plans.js'

// if (operation.action === 'scene-text')
export async function opSceneText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const scene = project.plot.scenes.items.find(item => item.id === operation.itemId)
  if (!scene) throw Object.assign(new Error('场景不存在'), { status: 404 })
  const fields = ['name', 'landmark', 'light', 'space', 'look']
  if (fields.some(key => scene[key] !== operation.original?.[key])) throw Object.assign(new Error('场景已更新，请刷新后编辑'), { status: 409 })
  const values = Object.fromEntries(fields.map(key => [key, String(operation.fields?.[key] || '').trim()]))
  if (Object.values(values).some(value => !value || value.length > 10000)) throw Object.assign(new Error('场景字段不能为空或超过10000字'), { status: 400 })
  if (values.name !== scene.name) throw Object.assign(new Error('场景名称用于素材关联，此处仅编辑描述'), { status: 400 })
  if (project.plot.scenes.items.some(item => item.id !== scene.id && item.name === values.name)) throw Object.assign(new Error('场景名称重复'), { status: 400 })
  project = await runNode('save', () => projects.save(project.id, current => editLinkedCard(current, 'scenes', scene.id, values, { newVariant: operation.newVariant })), { target: 'scenes' })
  const result = await (deps.reviewContent || reviewContent)({ project, stage: '场景文字编辑，仅审场景与大纲一致性，不要求重写大纲或人物卡', text: JSON.stringify(project.plot.scenes.items), route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, {}, { final: true })
  note('场景文字已保存并完成自审，图片保留')
  return trace
}

export const operations = {
  'scene-text': { label: '编辑场景文字', scope: 'episode', linkedCard: true, agent: false, plan: () => editSteps('scenes'), stage: 'episode', run: opSceneText },
}
