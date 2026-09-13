// 职责：从会话事件恢复媒体结果，并在当前轮次尾部统一展示。
window.__ModuleLoader__.load({
  id: 'elysium/conversation-results', factory: require => {
    const { createElement: h } = require('react')
    const { MediaTaskCard } = require('elysium/media-task-card')
    const { fromBlock } = require('elysium/media-task-state')
    const tools = new Set(['workflow_generate_video', 'workflow_resume_video'])
    // Rebuild from native conversation events, including history replay after refresh.
    const definition = {
      kind: 'elysium-media-results',
      match: event => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call' || (event.type === 'tool/result' && event.surfaceOp === 'append')) return { id: String(event.data.turn), role: 'update' }
        return null
      },
      start: (_context, match, reader) => ({ turn: match.event.data.turn, calls: new Set(), results: [],
        seen: new Set(reader?.previous('elysium-media-results')?.state.seen || []), inherited: new Set(reader?.previous('elysium-media-results')?.state.seen || []) }),
      update: ({ state }, { event }) => {
        if (event.type === 'tool/call') return tools.has(event.data.name)
          ? { ...state, calls: new Set([...state.calls, String(event.data.callId)]) } : state
        const callId = String(event.data.message.source.callId)
        const block = event.data.message.content[0]
        if (!state.calls.has(callId) || fromBlock(block).status === 'rejected') return state
        const jobId = fromBlock(block).job_id
        if (jobId && state.inherited.has(jobId)) return state
        const existing = state.results.find(item => item.callId === callId || jobId && item.jobId === jobId)
        const item = { callId, block, jobId: jobId || existing?.jobId, seq: existing?.seq ?? event.seq }
        return { ...state, seen: new Set([...state.seen, ...(jobId ? [jobId] : [])]),
          results: existing ? state.results.map(value => value === existing ? item : value) : [...state.results, item] }
      },
      buildLocationData: ({ state }, scope, previous) => {
        if (scope !== 'turn' || !state) return null
        if (previous?.value === state.results) return previous
        return { kind: 'turn', turn: state.turn, key: 'elysium-media-results', value: state.results }
      },
    }
    return { definition, apply(ctx) {
      ctx.uiConversation.events.register(definition)
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        select: owner => {
          const results = (owner.turn.data.get('elysium-media-results') || []).filter(item => item.seq <= owner.seq)
          return results.length ? results : null
        },
      }, ({ matched, sessionId }) => h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 } },
        matched.map((item, index) => h(MediaTaskCard, { ordinal: matched.length > 1 ? index + 1 : undefined, key: item.jobId || item.callId, sessionId, callId: item.callId, block: item.block })))))
    } }
  },
})
