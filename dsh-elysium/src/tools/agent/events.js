// 职责：从不可变会话事件中还原工具加载和视频失败状态；不决定最终可见工具。
// 判断本轮视频工具是否已出现不可继续的失败；首次输入校验失败仍允许修正一次。
export function videoFailedThisTurn(events) {
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  const calls = new Set()
  let inputInvalidCount = 0
  for (const event of events.slice(turnStart + 1)) {
    if (event.type === 'tool/call' && ['call_tools_video', 'call_tools_video_recover', 'workflow_generate_video', 'workflow_resume_video'].includes(event.data.name)) calls.add(event.data.callId)
    if (event.type !== 'tool/result') continue
    for (const block of event.data.message?.content || []) {
      if (block.type !== 'tool-result' || !calls.has(block.toolCallId)) continue
      if (block.isError) {
        const inputInvalid = (block.content || []).some(item => item.type === 'text' && item.text.includes('[MODEL_INPUT_INVALID]'))
        if (inputInvalid && ++inputInvalidCount === 1) continue
        return true
      }
      for (const item of block.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text), result = value.output || value
          if (result.status === 'failed' || result.status === 'rejected') return true
        } catch { /* Unrelated text is not a failed video result. */ }
      }
    }
  }
  return false
}

// 只从成功的加载工具回执恢复已授权名称；普通文本、失败回执和畸形结果均不授予工具。
export function loadedToolNames(events = []) {
  const calls = new Set()
  const loaded = new Set()
  for (const event of events) {
    if (event.type === 'tool/call' && ['call_tools_load', 'elysium_load_tools'].includes(event.data.name)) calls.add(event.data.callId)
    if (event.type !== 'tool/result') continue
    for (const block of event.data.message?.content || []) {
      if (block.type !== 'tool-result' || block.isError || !calls.has(block.toolCallId)) continue
      for (const item of block.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          for (const name of value.loaded_tools || []) if (typeof name === 'string') loaded.add(name)
        } catch { /* An unrelated or malformed result grants nothing. */ }
      }
    }
  }
  return loaded
}
