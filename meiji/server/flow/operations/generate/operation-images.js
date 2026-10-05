import { imageItems } from '../../../../shared/library-images.js'
const targets = (project, op) => {
  const seen = new Set()
  return imageItems(project, project, op.itemIds).filter(item => op.mode !== 'generate' || !item.ready).filter(({ card }) => {
    const key = card.ref ? `${card.ref.libraryId}/${card.ref.variantId}` : card.id
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}
export const operation = { label: '生成图片', scope: 'episode', agent: true, kind: 'generate',
  session: { tool: 'meiji_generate_images', description: '生成本集缺失图片，或重新生成指定图片；候选图由用户确认。', episode: true, modes: ['generate', 'regenerate'], params: { itemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true } } },
  completed: (project, op) => targets(project, op).length === 0,
  precheck(project, op) {
    if (!['generate', 'regenerate'].includes(op.mode)) throw new Error('图片模式无效')
    for (const { kind, card, pending } of targets(project, op)) {
      if (pending || card.image.operation) throw Object.assign(new Error('请先处理候选图或进行中的图片任务'), { status: 409 })
      if (project.plot[kind].check.passed !== true || !(kind === 'props' ? card.description?.trim() : card.look?.trim())) throw Object.assign(new Error(`卡片 ${card.id} 尚未通过审核或缺少生图资料`), { status: 409 })
    }
  },
  tasks: (project, op) => targets(project, op).map(({ kind, card }) => ({ type: kind === 'characters' ? 'character-image' : kind === 'scenes' ? 'scene-image' : 'prop-image', params: { itemId: card.id } })),
}
