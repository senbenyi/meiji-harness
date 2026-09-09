window.__ModuleLoader__.load({
  id: 'elysium-tools/media-results', factory: require => {
    const { createElement: h } = require('react')
    const { MediaTaskCard } = require('elysium-tools/media-card')
    const { fromBlock } = require('elysium-tools/media-model')
    const tools = new Set(['workflow_generate_video', 'workflow_resume_video', 'model_generate_video', 'model_generate_video_long', 'model_generate_image', 'model_concat_video', 'model_job_resume', 'model_character_view', 'model_character_sheet'])
    // Rebuild from native conversation events, including history replay after refresh.
    const definition = {
      kind: 'elysium-media-results',
      match: event => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call' || (event.type === 'tool/result' && event.surfaceOp === 'append')) return { id: String(event.data.turn), role: 'update' }
        return null
      },
      start: (_context, match) => ({ turn: match.event.data.turn, calls: new Set(), results: [] }),
      update: ({ state }, { event }) => {
        if (event.type === 'tool/call') return tools.has(event.data.name)
          ? { ...state, calls: new Set([...state.calls, String(event.data.callId)]) } : state
        const callId = String(event.data.message.source.callId)
        const block = event.data.message.content[0]
        if (!state.calls.has(callId) || fromBlock(block).status === 'rejected') return state
        return { ...state, results: [...state.results.filter(item => item.callId !== callId), { callId, block, seq: event.seq }] }
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
        matched.map((item, index) => h(MediaTaskCard, { ordinal: matched.length > 1 ? index + 1 : undefined, key: item.callId, sessionId, callId: item.callId, block: item.block })))))
    } }
  },
})
