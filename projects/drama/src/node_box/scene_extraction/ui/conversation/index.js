import { renderRecordedRows } from '../../../../client/ui/conversation-content.js'

export const conversation = {
  renderInput(body, data, { node }) {
    if (!data.story_outline && !data.current_scenes) return false
    if (data.instruction) body.append(node('h4', '场景提取要求'), node('p', data.instruction))
    if (data.story_outline) renderRecordedRows(body, data.story_outline.segments, '故事大纲', { node })
    if (data.current_scenes) renderRecordedRows(body, data.current_scenes.scenes, '本次输入场景', { node })
    return true
  },
  renderStepOutput(body, result, tools) { return renderRecordedRows(body, result?.output?.scenes, '场景提取', tools) },
  outcome(group) {
    const saved = group.context.saved
    return { headline: saved ? '场景提取已保存' : '操作已完成', description: saved ? '审核通过，场景资料已更新。' : '本次未更新场景提取。',
      retained: saved ? '最新场景候选已自动保存，审核状态单独记录。' : '本次尚未产生可保存的有效结果。' }
  },
  appendActions(actions, group, finalReference, { get, modal, node, button }) {
    if (!group.context.saved || !finalReference) return
    actions.append(button('查看本次场景', async () => {
      const data = await get(finalReference)
      if (!Array.isArray(data.final_output?.scenes)) throw new Error('本次场景暂不可读')
      modal('本次保存的场景提取', body => renderRecordedRows(body, data.final_output.scenes, '场景提取', { node }))
    }))
  },
}
