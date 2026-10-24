import { renderRecordedRows } from '../../../../client/ui/conversation-content.js'

export const conversation = {
  renderInput(body, data, { node }) {
    if (!data.story_outline && !data.current_shots) return false
    if (data.instruction) body.append(node('h4', '分镜要求'), node('p', data.instruction))
    if (data.story_outline) renderRecordedRows(body, data.story_outline.segments, '故事大纲', { node })
    if (data.scene_extraction) renderRecordedRows(body, data.scene_extraction.scenes, '场景资料', { node })
    if (data.group_setting) renderRecordedRows(body, data.group_setting.groups, '团队资料', { node })
    if (data.character_extraction) renderRecordedRows(body, data.character_extraction.characters, '人物资料', { node })
    if (data.current_shots) renderRecordedRows(body, data.current_shots.shots, '本次输入分镜', { node })
    return true
  },
  renderStepOutput(body, result, tools) { return renderRecordedRows(body, result?.output?.shots, '分镜', tools) },
  outcome(group) {
    const saved = group.context.saved
    return { headline: saved ? '分镜已保存' : '操作已完成', description: saved ? '审核通过，分镜资料已更新。' : '本次未更新分镜。',
      retained: saved ? '最新分镜候选已自动保存，审核状态单独记录。' : '本次尚未产生可保存的有效结果。' }
  },
  appendActions(actions, group, finalReference, { get, modal, node, button }) {
    if (!group.context.saved || !finalReference) return
    actions.append(button('查看本次分镜', async () => {
      const data = await get(finalReference)
      if (!Array.isArray(data.final_output?.shots)) throw new Error('本次分镜暂不可读')
      modal('本次保存的分镜', body => renderRecordedRows(body, data.final_output.shots, '分镜', { node }))
    }))
  },
}
