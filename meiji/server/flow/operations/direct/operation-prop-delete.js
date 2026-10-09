// 操作：删除道具
import { plotPatch } from '../../../models/data/drama-model.js'
import { saveStep } from '../../../../shared/task-plans.js'

export async function opPropDelete(c) {
  const { operation, projects, project, trace, note } = c
  const item = project.plot.props.items.find(item => item.id === operation.itemId)
  if (!item) throw Object.assign(new Error('道具不存在'), { status: 404 })
  await projects.save(project.id, current => {
    const props = current.plot.props
    if (!props.items.some(item => item.id === operation.itemId)) throw Object.assign(new Error('道具不存在'), { status: 404 })
    const revision = props.revision + 1
    return {
      ...plotPatch(current, { props: { ...props, revision, check: { ...props.check, revision }, items: props.items.filter(item => item.id !== operation.itemId) } }),
      pendingImages: Object.fromEntries(Object.entries(current.pendingImages || {}).filter(([, draft]) => draft.itemId !== operation.itemId)),
    }
  })
  note(`已删除道具 ${item.id} · ${item.name}`)
  return trace
}

export const operations = {
  'prop-delete': { label: '删除道具', scope: 'episode', agent: false, step: saveStep('props'), stage: 'episode', run: opPropDelete },
}
