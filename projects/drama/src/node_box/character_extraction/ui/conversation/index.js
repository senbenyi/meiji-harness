import { renderRecordedRows } from '../../../../client/ui/conversation-content.js'

export const conversation = {
  renderInput(body, data, { node }) {
    if (!data.story_outline && !data.current_characters) return false
    if (data.instruction) body.append(node('h4', '角色要求'), node('p', data.instruction))
    if (data.story_outline) renderRecordedRows(body, data.story_outline.segments, '故事大纲', { node })
    if (data.scene_extraction) renderRecordedRows(body, data.scene_extraction.scenes, '场景资料', { node })
    if (data.group_setting) renderRecordedRows(body, data.group_setting.groups, '已确认团队', { node })
    if (data.current_characters) {
      renderRecordedRows(body, data.current_characters.groups, '本次输入团队', { node })
      renderRecordedRows(body, data.current_characters.characters, '本次输入人物', { node })
    }
    return true
  },
  renderStepOutput(body, result, tools) {
    const groups = renderRecordedRows(body, result?.output?.groups, '团队设定', tools)
    const characters = renderRecordedRows(body, result?.output?.characters, '人物提取', tools)
    return groups || characters
  },
  outcome(group) {
    const saved = group.context.saved
    return { headline: saved ? '人物资料已保存' : '操作已完成', description: saved ? '审核通过，人物及个人服装已更新。' : '本次未更新角色。',
      retained: saved ? '最新角色已自动保存，审核状态单独记录。' : '本次尚未产生可保存的有效结果。' }
  },
  appendActions(actions, group, finalReference, { get, modal, node, button }) {
    if (!group.context.saved) return
    actions.append(button('查看本次角色', async () => {
      const data = await get(finalReference)
      if (!Array.isArray(data.final_output?.characters)) throw new Error('本次角色暂不可读')
      modal('本次保存的人物', body => {
        renderRecordedRows(body, data.final_output.groups, '团队设定', { node })
        renderRecordedRows(body, data.final_output.characters, '人物提取', { node })
      })
    }))
  },
}
