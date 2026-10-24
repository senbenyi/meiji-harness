import { renderRecordedRows } from '../../../../client/ui/conversation-content.js'

export const conversation = {
  renderInput(body, data, { node }) {
    if (!data.story_outline && !data.current_characters) return false
    if (data.instruction) body.append(node('h4', '角色要求'), node('p', data.instruction))
    if (data.story_outline) renderRecordedRows(body, data.story_outline.segments, '故事大纲', { node })
    if (data.current_characters) renderRecordedRows(body, data.current_characters.characters, '本次输入角色', { node })
    return true
  },
  renderStepOutput(body, result, tools) {
    return renderRecordedRows(body, result?.output?.characters, '角色', tools)
  },
  outcome(group) {
    const saved = group.context.saved
    return { headline: saved ? '角色完成，已保存' : '操作已完成', description: saved ? '审核通过，角色已更新。' : '本次未更新角色。',
      retained: saved ? '最新角色已自动保存，审核状态单独记录。' : '本次尚未产生可保存的有效结果。' }
  },
  appendActions(actions, group, finalReference, { get, modal, node, button }) {
    if (!group.context.saved) return
    actions.append(button('查看本次角色', async () => {
      const data = await get(finalReference)
      if (!Array.isArray(data.final_output?.characters)) throw new Error('本次角色暂不可读')
      modal('本次保存的角色', body => renderRecordedRows(body, data.final_output.characters, '角色', { node }))
    }))
  },
}
