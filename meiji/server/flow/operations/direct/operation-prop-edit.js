import { editLinkedCard } from '../../../../shared/library-rules.js'
import { editSteps } from '../../../../shared/task-plans.js'
import { runNode } from '../../../runtime/task-execution.js'
import { reviewContent } from '../../steps/step-review-edited-content.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { checkContext } from '../../../runtime/operation-context.js'

export async function opPropText(c) {
  const { operation: op, projects, models, deps } = c
  const card = c.project.plot.props.items.find(item => item.id === op.itemId)
  if (!card) throw Object.assign(new Error('道具不存在'), { status: 404 })
  const keys = ['name', 'description', 'evidence']
  if (keys.some(key => card[key] !== op.original?.[key])) throw Object.assign(new Error('道具已更新，请刷新'), { status: 409 })
  const fields = Object.fromEntries(keys.map(key => [key, String(op.fields?.[key] || '').trim()]))
  if (Object.values(fields).some(value => !value || value.length > 10000)) throw Object.assign(new Error('道具字段不能为空或超过 10000 字'), { status: 400 })
  if (c.project.plot.props.items.some(item => item.id !== card.id && item.name === fields.name)) throw Object.assign(new Error('道具名称重复'), { status: 400 })
  const project = await runNode('save', () => projects.save(c.project.id, current => editLinkedCard(current, 'props', card.id, fields, { newVariant: op.newVariant })), { target: 'props' })
  const check = await (deps.reviewContent || reviewContent)({ project, stage: '道具文字编辑，核对大纲依据与道具准入', text: JSON.stringify(project.plot.props.items), route: modelRoutes(await models.read()).story })
  checkContext.getStore().validation = check.failures
  await projects.save(project.id, {}, { final: true }); c.note('道具文字已保存并完成自审'); return c.trace
}
export const operations = { 'prop-text': { label: '编辑道具文字', scope: 'episode', linkedCard: true, agent: false, plan: () => editSteps('props'), stage: 'episode', run: opPropText } }
