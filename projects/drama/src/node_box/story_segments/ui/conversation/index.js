import { renderRecordedRows as renderRows } from '../../../../client/ui/conversation-content.js'

// 故事段随会话自然展开，避免共享长文本样式形成段内滚动区。
const renderRecordedRows = (body, rows, title, { node }) => renderRows(body, rows, title, {
  node: (tag, text, cls) => {
    const element = node(tag, text, cls)
    if (tag === 'pre') {
      element.style.maxHeight = 'none'
      element.style.overflow = 'visible'
    }
    return element
  },
})

export const conversation = {
  renderInput(body, data, { node, payload }) {
    if (!data.basic_info && !data.current_outline) return false
    if (data.instruction) body.append(node('h4', '大纲要求'), node('p', data.instruction))
    if (data.basic_info?.actual_script !== undefined) payload(body, '当前工作剧本', data.basic_info.actual_script)
    if (data.current_outline) renderRecordedRows(body, data.current_outline.segments, '本次输入大纲', { node })
    return true
  },
  renderStepOutput(body, result, tools) {
    return renderRecordedRows(body, result?.output?.segments, '故事大纲', tools)
  },
  outcome(group) {
    const saved = group.context.saved
    return { headline: saved ? '大纲完成，已保存' : '操作已完成', description: saved ? '审核通过，故事大纲已更新。' : '本次未更新故事大纲。',
      retained: saved ? '最新故事大纲已自动保存，审核状态单独记录。' : '本次尚未产生可保存的有效结果。' }
  },
  appendActions(actions, group, finalReference, { get, modal, node, button }) {
    if (!group.context.saved) return
    actions.append(button('查看本次大纲', async () => {
      const data = await get(finalReference)
      if (!Array.isArray(data.final_output?.segments)) throw new Error('本次大纲暂不可读')
      modal('本次保存的故事大纲', body => renderRecordedRows(body, data.final_output.segments, '故事大纲', { node }))
    }))
  },
}
