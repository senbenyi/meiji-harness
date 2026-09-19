// 职责：从不可变会话事件中还原工具加载、视频失败与用户重试意图；不决定最终可见工具。
import { MEDIA_TOOLS, mediaToolNames } from '../worker/index.js'
// 判断本轮视频工具是否已出现不可继续的失败；首次输入校验失败仍允许修正一次。
export function videoFailedThisTurn(events) {
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  const calls = new Set()
  let inputInvalidCount = 0
  for (const event of events.slice(turnStart + 1)) {
    if (event.type === 'tool/call' && mediaToolNames('video').includes(event.data.name)) calls.add(event.data.callId)
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
    if (event.type === 'tool/call' && event.data.name === 'call_tools_load') calls.add(event.data.callId)
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

// 本轮用户原话是否明确要求重试；否定表达优先。Agent 调用恢复工具前以此作为用户同意。
export function userRequestedRetry(events = []) {
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  const text = events.slice(turnStart + 1).filter(event => event.type === 'user/message' && event.data.source?.kind === 'user')
    .flatMap(event => event.data.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
  if (/(不要|不许|禁止|无需|别)\s*(自动)?\s*(重试|恢复|继续)/i.test(text)) return false
  return /(重试|恢复|继续|\bretry\b|\bresume\b|\bcontinue\b)/i.test(text)
}

const mediaTools = new Map(Object.entries(MEDIA_TOOLS).flatMap(([kind, tools]) => Object.entries(tools).map(([action, name]) => [name, { kind, action }])))

// 将 Harness 工具事件归一化为 worker 可消费的媒体调用历史；只信任配对成功回执中的任务 ID。
export function mediaCalls(events = []) {
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  const calls = []
  for (const [index, event] of events.entries()) {
    const tool = event.type === 'tool/call' && mediaTools.get(event.data.name)
    if (tool) calls.push({ callId: event.data.callId, ...tool, currentTurn: index > turnStart })
    if (event.type !== 'tool/result') continue
    for (const block of event.data.message?.content || []) {
      const call = !block.isError && block.type === 'tool-result' && calls.find(item => item.callId === block.toolCallId)
      if (!call) continue
      for (const item of block.content || []) {
        try {
          const value = JSON.parse(item.text), jobId = value.job_id || value.output?.job_id
          if (/^[a-f0-9]{32}$/.test(jobId)) call.jobId = jobId
        } catch { /* Unrelated text has no trusted job identity. */ }
      }
    }
  }
  return calls
}
