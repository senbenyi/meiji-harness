import { currentSessionId } from './workbench.js'
import { createTaskOperation, groupTaskMessages } from './ui/task-operation.js'

/** 仅适配本项目程序消息座位，不改宿主事件、其他聊天消息或输入实例。 */
export function mountTaskMessages({ document = globalThis.document, getSessionId = currentSessionId, fetcher = globalThis.fetch,
  copy = text => globalThis.navigator.clipboard.writeText(text), interval = 2000, onNotify } = {}) {
  const host = document.createElement('drama-task-messages')
  host.setAttribute('aria-label', '盒子任务消息')
  const root = host.attachShadow({ mode: 'open' }), list = document.createElement('section'), local = document.createElement('style')
  local.textContent = ':host{display:block;flex-shrink:0;max-width:760px;width:calc(100% - 48px);margin:24px auto}'
  root.append(local, list)
  const layout = document.createElement('style')
  layout.textContent = `
    [data-conversation-scroll]:has(> drama-task-messages){justify-content:flex-start}
    [data-conversation-scroll]:has(> drama-task-messages) > [data-composer-seat]{position:sticky;bottom:0;margin-top:auto;z-index:7;background:var(--dsw-alias-bg-base,#fff)}
    [data-drama-task-hero]{display:none!important}
    [data-drama-task-composer]{padding-bottom:12px!important}
    [data-drama-operation-anchor] > [data-slot="conversation.chat.node"]{display:none!important}
    [data-drama-operation-hidden]{display:none!important}
  `
  document.head.append(layout)
  let disposed = false, session, version = 0, pending = null, cursor = -1
  let pendingGroups = []
  let groups = []
  const requests = new Map()
  const views = new Map(), full = new Map(), ready = new Map(), anchors = new Set(), hidden = new Set()
  const locate = () => [...document.querySelectorAll('[data-conversation-content]')].find(node => node.dataset.conversationSession === getSessionId())
  const clearHero = () => {
    for (const node of document.querySelectorAll('[data-drama-task-hero],[data-drama-task-composer]')) {
      node.removeAttribute('data-drama-task-hero'); node.removeAttribute('data-drama-task-composer')
    }
  }
  const clearNative = () => {
    for (const node of anchors) node.removeAttribute('data-drama-operation-anchor')
    for (const node of hidden) node.removeAttribute('data-drama-operation-hidden')
    anchors.clear(); hidden.clear()
  }
  const seat = () => {
    const content = locate(), scroller = content?.querySelector('[data-conversation-scroll]')
    if (!scroller || !groups.length) { host.remove(); clearHero(); clearNative(); for (const view of views.values()) view.element.remove(); return }
    const hero = content.dataset.contentPhase === 'hero'
    if (hero) {
      clearNative()
      for (const group of groups) { const el = views.get(group.id).element; if (el.parentNode !== list) list.append(el) }
      if (host.parentNode !== scroller) scroller.prepend(host)
      const composer = scroller.querySelector('[data-composer-seat]'), input = composer?.querySelector('[data-slot="conversation.composer.bar"]')
      let heading = composer?.querySelector('[data-slot="conversation.hero.brand.mark"]')
      if (input && heading) {
        while (heading.parentElement && heading.parentElement !== composer && !heading.parentElement.contains(input)) heading = heading.parentElement
        heading.setAttribute('data-drama-task-hero', ''); heading.parentElement.setAttribute('data-drama-task-composer', '')
      }
    } else {
      host.remove(); clearHero()
      const nextAnchors = new Set(), nextHidden = new Set(), seats = [...content.querySelectorAll('[data-chat-node-key]')]
      const byKey = new Map(), positions = new Map()
      seats.forEach((node, index) => { const key = node.getAttribute('data-chat-node-key'); if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(node); positions.set(node, index) })
      for (const group of groups) {
        const members = group.messages.flatMap(message => byKey.get(`7:command${message.id}`) || []).sort((a, b) => positions.get(a) - positions.get(b))
        const anchor = members[0], view = views.get(group.id)
        if (!anchor) { view.element.remove(); continue } // 原生虚拟列表未加载此段历史时不另造位置。
        nextAnchors.add(anchor)
        if (!anchor.hasAttribute('data-drama-operation-anchor')) anchor.setAttribute('data-drama-operation-anchor', '')
        if (view.element.parentNode !== anchor) anchor.append(view.element)
        for (const member of members.slice(1)) { nextHidden.add(member); if (!member.hasAttribute('data-drama-operation-hidden')) member.setAttribute('data-drama-operation-hidden', '') }
      }
      for (const node of anchors) if (!nextAnchors.has(node)) node.removeAttribute('data-drama-operation-anchor')
      for (const node of hidden) if (!nextHidden.has(node)) node.removeAttribute('data-drama-operation-hidden')
      anchors.clear(); hidden.clear(); for (const node of nextAnchors) anchors.add(node); for (const node of nextHidden) hidden.add(node)
    }
  }
  const reset = () => { version++; groups = []; cursor = -1; pendingGroups = []; full.clear(); ready.clear(); for (const view of views.values()) view.dispose(); views.clear(); host.remove(); clearHero(); clearNative() }
  const loadMessage = (id, owner = session) => {
    if (owner !== session || disposed) return Promise.reject(new Error('会话已切换'))
    if (full.has(id)) return full.get(id)
    const promise = (async () => {
      const response = await fetcher(`/api/drama/task-messages?session_id=${encodeURIComponent(owner)}&id=${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error('记录读取失败')
      const data = await response.json()
      if (owner !== getSessionId() || disposed) throw new Error('会话已切换')
      const message = data.messages.find(message => message.id === id)
      if (!message) throw new Error('记录暂不可用，请重试')
      ready.set(id, message)
      return message
    })().catch(error => { full.delete(id); throw error })
    full.set(id, promise); return promise
  }
  const refresh = async () => {
    const id = getSessionId()
    if (id !== session) { reset(); session = id }
    if (!id || disposed || !locate()) { host.remove(); clearHero(); clearNative(); return }
    if (pending?.session === id) return pending.promise
    const ticket = version
    const promise = (async () => {
      try {
        const response = await fetcher(`/api/drama/task-messages?session_id=${encodeURIComponent(id)}&compact=1&eager=1&after=${cursor}${pendingGroups.length ? `&pending=${encodeURIComponent(pendingGroups.join(','))}` : ''}`)
        if (!response.ok) throw new Error('任务消息读取失败')
        const { messages, details = [], cursor: nextCursor } = await response.json()
        if (disposed || ticket !== version || id !== getSessionId()) return
        for (const message of details) { ready.set(message.id, message); full.set(message.id, Promise.resolve(message)) }
        if (Number.isSafeInteger(nextCursor)) cursor = nextCursor
        pendingGroups = [...new Set(messages.filter(message => ['queued', 'running'].includes(message.operation_status)).map(message => message.group_id).filter(Boolean))]
        const scroller = locate()?.querySelector('[data-conversation-scroll]')
        const follow = locate()?.dataset.contentPhase === 'hero' && scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
        groups = groupTaskMessages(messages)
        const wanted = new Set(groups.map(group => group.id))
        for (const [key, view] of views) if (!wanted.has(key)) { view.dispose(); views.delete(key) }
        for (const group of groups) {
          if (!views.has(group.id)) views.set(group.id, createTaskOperation(document, { copy, onNotify, getMessage: messageId => id === session ? ready.get(messageId) : undefined,
            loadMessage: messageId => loadMessage(messageId, id),
            onDecision: async (group, action) => {
              if (id !== getSessionId() || disposed) throw new Error('会话已切换')
              if (action === 'stop') return
              const key = `${group.id}:${action}`
              if (!requests.has(key)) requests.set(key, globalThis.crypto.randomUUID())
              const endpoint = { script_revision: 'script-optimization', story_segments: 'story-outline', character_extraction: 'characters', costume_image: 'costume-images' }[group.context.node_type]
              if (!endpoint) throw new Error('此任务不支持重试')
              const response = await fetcher(`/api/drama/${endpoint}?session_id=${encodeURIComponent(id)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
                body: JSON.stringify({ instruction: group.goal || group.name, retry_of: group.id, retry_action: action, request_id: requests.get(key) }),
              })
              const data = await response.json()
              if (!response.ok) throw new Error(data.message || '提交失败')
            },
            loadHistory: async groupId => {
              const response = await fetcher(`/api/drama/task-history?session_id=${encodeURIComponent(id)}&id=${encodeURIComponent(groupId)}`)
              if (!response.ok) throw new Error('任务记录读取失败')
              const data = await response.json()
              if (id !== getSessionId() || disposed) throw new Error('会话已切换')
              return data.detail
            } }))
          views.get(group.id).update(group)
        }
        seat()
        if (follow) scroller.scrollTop = scroller.scrollHeight
      } catch { /* 临时断网保留当前会话，下一次轮询重试。 */ }
    })()
    pending = { session: id, promise }
    try { await promise } finally { if (pending?.promise === promise) pending = null }
  }
  const observer = new document.defaultView.MutationObserver(seat)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-content-phase', 'data-conversation-session', 'data-chat-node-key'] })
  const timer = setInterval(refresh, interval)
  void refresh()
  return { refresh, element: host, dispose() { disposed = true; observer.disconnect(); clearInterval(timer); reset(); layout.remove() } }
}
