// 旧任务只从 Harness 公开会话事件读取当时的脱敏请求，不访问其私有存储或重建提示词。
export function stepPromptsFromLog(session, task, step) {
  if (typeof session?.snapshotEvents !== 'function') return []
  if (task.nodes.filter(item => item.kind === step.kind).length !== 1) return []
  const active = new Set(), names = new Map(), prompts = []
  let ambiguous = false
  for (const event of session.snapshotEvents()) {
    const data = event.data || {}
    if (event.type === 'command/run') names.set(data.commandId, data.name || '')
    if (event.type !== 'command/done') continue
    const text = data.text || ''
    const start = text.match(/^任务 ([a-zA-Z0-9_-]+) 开始：/m)
    if (start) {
      active.add(start[1])
      if (active.has(task.id) && active.size > 1) ambiguous = true
      continue
    }
    const end = text.match(/^任务 ([a-zA-Z0-9_-]+) 执行结束：/m)
    if (end) { active.delete(end[1]); continue }
    if (!active.has(task.id) || active.size !== 1) continue
    const name = names.get(data.commandId) || ''
    if (!name.endsWith('-发起请求')) continue
    const fn = text.match(/^函数：([^\n]+)/m)?.[1]
    const kind = fn === 'generateGatewayImage' ? 'image_generate' : fn === 'submitGatewayVideo' ? 'video_submit'
      : fn === 'completeChat' ? /·复审-/.test(name) ? 're_review' : /·(?:自动修订|修订)-/.test(name) ? 'revise' : /·自审-/.test(name) ? 'review' : 'generate' : null
    if (kind !== step.kind) continue
    const raw = text.match(/^参数：([\s\S]*)/m)?.[1]
    if (!raw) continue
    let body
    try { body = JSON.parse(raw) } catch { continue }
    if (fn === 'completeChat' && Array.isArray(body.messages) && body.messages.every(message => typeof message.role === 'string' && typeof message.content === 'string')) {
      prompts.push({ kind: 'text', messages: body.messages.map(({ role, content }) => ({ role, content })) })
    } else if (fn !== 'completeChat' && typeof body.prompt === 'string') {
      prompts.push({ kind: fn === 'generateGatewayImage' ? 'image' : 'video', prompt: body.prompt })
    }
  }
  return ambiguous ? [] : prompts
}
