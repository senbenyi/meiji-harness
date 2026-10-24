import { renderRecordedRows } from '../../../../client/ui/conversation-content.js'

export const conversation = {
  renderInput(body, data, { node }) {
    if (!data.story_outline && !data.current_groups) return false
    if (data.instruction) body.append(node('h4', '团队设定要求'), node('p', data.instruction))
    if (data.story_outline) renderRecordedRows(body, data.story_outline.segments, '故事大纲', { node })
    if (data.scene_extraction) renderRecordedRows(body, data.scene_extraction.scenes, '场景资料', { node })
    if (data.current_groups) renderRecordedRows(body, data.current_groups.groups, '本次输入团队', { node })
    return true
  },
  renderStepOutput(body, result, tools) { return renderRecordedRows(body, result?.output?.groups, '团队设定', tools) },
  outcome(group) {
    const saved = group.context.saved
    return { headline: saved ? '团队设定已保存' : '操作已完成', description: saved ? '审核通过，团队形象与共同服装已更新。' : '本次未更新团队设定。',
      retained: saved ? '最新团队候选已自动保存，审核状态单独记录。' : '本次尚未产生可保存的有效结果。' }
  },
  appendActions(actions, group, finalReference, { get, modal, node, button }) {
    if (!group.context.saved || !finalReference) return
    actions.append(button('查看本次团队', async () => {
      const data = await get(finalReference)
      if (!Array.isArray(data.final_output?.groups)) throw new Error('本次团队暂不可读')
      modal('本次保存的团队设定', body => renderRecordedRows(body, data.final_output.groups, '团队设定', { node }))
    }))
  },
}
