// 职责：桥接当前 Harness 会话，并展示按阶段执行的项目工作流。
window.__ModuleLoader__.load({ id: 'elysium/project-generation', factory: require => {
  const { createElement: h, useEffect, useState } = require('react')
  const { workflowAction, fetchProject, fetchProjects } = require('elysium/project-api')
  let sessions, workspaces, navigation, modelDirectories
  const mountedAt = Date.now(), opened = new Set()
  const openProject = id => window.dispatchEvent(new CustomEvent('elysium:open-project', { detail: { id } }))
  async function selectProject(id) {
    if (!sessions) throw new Error('会话服务尚未就绪，请刷新页面')
    const project = await fetchProject(id)
    await sessions.refresh()
    const snapshot = sessions.list.getSnapshot()
    let sessionId = project.chat_session_id
    const spaces = workspaces.list.getSnapshot().items
    const attached = spaces.find(item => item.sessionIds.includes(sessionId))
    if (!sessionId || !snapshot.byId[sessionId] || !attached && snapshot.byId[sessionId].blank) {
      const workspace = spaces.find(item => item.sessionIds.includes(project.session_id))
        || spaces.find(item => item.sessionIds.includes(snapshot.current))
        || spaces.find(item => item.path === snapshot.byId[sessionId]?.cwd)
        || (spaces.length === 1 ? spaces[0] : null)
      if (!workspace) throw new Error('请先在 Harness 选择工作区，再打开项目')
      sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
      await workflowAction(id, 'bind-session', { session_id: sessionId })
    }
    navigation.openSession(sessionId)
    return sessionId
  }
  function watchSession(listener) {
    if (!sessions) return () => {}
    let previous = sessions.list.getSnapshot().current
    return sessions.list.subscribe(() => { const current = sessions.list.getSnapshot().current; if (current !== previous) { previous = current; listener(current) } })
  }
  function useProductionSession(sessionId) {
    const [state, setState] = useState(null)
    useEffect(() => {
      setState(null)
      let face, unsubscribe
      const connect = () => {
        const scope = sessionId && sessions?.scope(sessionId), next = scope && sessions.sessionOf?.(scope)
        if (next === face) return
        unsubscribe?.(); face = next
        if (!face) { setState(null); return }
        const update = () => { const s = face.getSnapshot(); setState({ running: s.running, error: s.lastAgentError, ready: s.openState === 'open' }) }
        update(); unsubscribe = face.subscribe(update)
      }
      connect()
      const unsubscribeList = sessions?.list.subscribe?.(connect)
      return () => { unsubscribe?.(); unsubscribeList?.() }
    }, [sessionId])
    return state
  }
  async function projectForSession(id) {
    return (await fetchProjects()).find(p => p.chat_session_id === id)?.id || null
  }
  function ProjectCreated({ block, sessionId }) {
    let value
    for (const item of block?.content || []) try { const parsed = JSON.parse(item.text); value = parsed.output || parsed } catch {}
    useEffect(() => {
      if (!value?.id || !value.created_at || value.created_at < mountedAt || opened.has(value.id) || sessions?.list.getSnapshot().current !== sessionId) return
      opened.add(value.id); openProject(value.id)
    }, [value?.id, value?.created_at, sessionId])
    return value?.id ? h('button', { onClick: () => openProject(value.id) }, '请配置项目素材 · 打开项目') : null
  }
  function StoryModel({ sessionId }) {
    const [selection, setSelection] = useState(null)
    useEffect(() => {
      setSelection(null)
      if (!sessionId || !modelDirectories) return
      let unsubscribeModel
      const connect = () => {
        if (unsubscribeModel || !sessions?.scope(sessionId)) return
        const directory = modelDirectories.directoryFor(sessionId)
        const update = () => setSelection(directory.store.getSnapshot().current)
        update()
        unsubscribeModel = directory.store.subscribe(update)
        directory.load().catch(() => {})
      }
      const unsubscribeSessions = sessions?.list.subscribe(connect)
      connect()
      return () => { unsubscribeSessions?.(); unsubscribeModel?.() }
    }, [sessionId])
    return h('p', { className: 'elysium-story-model' }, `大模型：${selection ? `${selection.provider} / ${selection.model}` : '等待会话模型加载'}`)
  }
  function VideoModel() {
    const [label, setLabel] = useState('等待视频模型加载')
    useEffect(() => {
      let active = true
      try {
        require('elysium/settings-api').settingsRequest('models').then(value => {
          if (!active) return
          const origin = value.origin?.video
          const id = origin === 'third' ? value.third_party_selected?.video : value.selected?.video
          const models = origin === 'third' ? value.third_party?.video : value.models?.video
          const item = (models || []).find(model => model.id === id)
          setLabel(item?.label || item?.model || id || '未选择')
        }).catch(() => { if (active) setLabel('未加载') })
      } catch { if (active) setLabel('未加载') }
      return () => { active = false }
    }, [])
    return h('p', { className: 'elysium-story-model' }, `大模型：${label}`)
  }
  function apply(ctx) {
    modelDirectories = ctx.modelDirectories
    sessions = ctx.sessions
    workspaces = ctx.workspaces
    navigation = ctx.uiWorkspace
    if (!sessions) return
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'project_create' }, props => h(ProjectCreated, props)))
    // 工具组默认折叠，导航必须由可见的轮次尾部触发，而非依赖用户展开工具。
    ctx.uiConversation.events.register({
      kind: 'elysium-project-created',
      match: event => event.type === 'turn/start' ? { id: String(event.data.turn), role: 'start' }
        : event.type === 'tool/call' || event.type === 'tool/result' && event.surfaceOp === 'append' ? { id: String(event.data.turn), role: 'update' } : null,
      start: (_context, match) => ({ turn: match.event.data.turn, calls: new Set(), results: [] }),
      update: ({ state }, { event }) => {
        if (event.type === 'tool/call') return event.data.name === 'project_create' ? { ...state, calls: new Set([...state.calls, String(event.data.callId)]) } : state
        const callId = String(event.data.message.source.callId), block = event.data.message.content[0]
        if (!state.calls.has(callId) || block?.isError) return state
        return { ...state, results: [...state.results.filter(item => item.callId !== callId), { callId, block, seq: event.seq }] }
      },
      buildLocationData: ({ state }, scope) => scope === 'turn' && state ? { kind: 'turn', turn: state.turn, key: 'elysium-project-created', value: state.results } : null,
    })
    ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail',
      select: owner => { const items = (owner.turn.data.get('elysium-project-created') || []).filter(item => item.seq <= owner.seq); return items.length ? items : null },
    }, ({ matched, sessionId }) => h('div', null, matched.map(item => h(ProjectCreated, { key: item.callId, block: item.block, sessionId })))))
  }
  async function generate(project, stage, episodeId) {
    const sessionId = sessions?.list.getSnapshot().current
    if (project.chat_session_id && project.chat_session_id !== sessionId) throw new Error('请先切换到该项目的关联对话')
    const conversation = sessionId && sessions.scope(sessionId)?.get('conversation')
    if (!conversation) throw new Error('请先打开一个 Harness 会话，再点击下一步')
    const workflow = episodeId ? project.episodes.find(item => item.id === episodeId).workflow : project.workflow
    const value = await workflowAction(project.id, 'request', { revision: workflow.revision, stage, session_id: sessionId, ...(episodeId ? { episode_id: episodeId } : {}) })
    const requested = episodeId ? value.episodes.find(item => item.id === episodeId).workflow : value.workflow
    try {
      await conversation.send(`请执行项目 ${project.id} 的${episodeId ? `剧集 ${episodeId}` : `全剧 ${value.episode_count || 1} 集`}${stage === 'plot' ? '剧情' : '分镜'}生成步骤。request_id=${requested.request.id}。先 project_generation_read 读取资料，再 project_generation_complete 保存结果；仅执行此阶段，不生成视频。`)
    } catch (error) { await workflowAction(project.id, 'cancel', { revision: requested.revision, ...(episodeId ? { episode_id: episodeId } : {}) }); throw error }
    return value
  }
  async function generateProduction(project, stage, segmentId, restart = false) {
    const sessionId = sessions?.list.getSnapshot().current
    if (project.chat_session_id !== sessionId) throw new Error('请先选择项目关联对话')
    const conversation = sessions.scope(sessionId)?.get('conversation')
    if (!conversation) throw new Error('项目对话尚未就绪')
    const current = restart ? await fetchProject(project.id) : project
    const value = await workflowAction(project.id, 'production-request', { revision: current.production.revision, stage, ...(stage === 'story' ? { plan_segments: true } : {}), segment_id: segmentId, session_id: sessionId, restart })
    try {
      if (restart && sessions.sessionOf?.(sessions.scope(sessionId))?.getSnapshot().running) await conversation.cancel()
      await conversation.send(productionMessage(value))
    } catch (error) {
      await workflowAction(project.id, 'production-request-error', { revision: value.production.revision, request_id: value.production.request.id, error: error.message }).catch(() => {})
      throw error
    }
    return value
  }
  async function restartProductionAction(project, name, body = {}) {
    const current = await fetchProject(project.id)
    const value = await workflowAction(project.id, `production-${name}`, { revision: current.production.revision, ...body, restart: true })
    const scope = current.production.request && sessions?.scope(current.chat_session_id)
    if (scope && sessions.sessionOf?.(scope)?.getSnapshot().running) await scope.get('conversation').cancel()
    return value
  }
  const productionMessage = project => `执行项目 ${project.id} 的 ${project.production.request.stage} 阶段，request_id=${project.production.request.id}。项目目标总时长为 ${project.production.target_seconds} 秒；剧情与 Segment 合计可在目标上下 30 秒内，不必精确相等。先 project_production_read。${project.production.request.plan_segments ? '本阶段同时规划剧情、Scene 和每个 Scene 内的 4～15 秒 Segment；按 read 返回的嵌套结构，一次调用 project_production_complete 返回完整 JSON，一并保存。' : '按 request.batch 分批调用 project_production_complete 返回完整 JSON。每批保存后重新 read，直到回执 request=null；中断则从已保存的下一批继续，不重复生成。'}仅执行当前阶段，不生成视频。`
  async function resumeProduction(project) {
    const sessionId = sessions?.list.getSnapshot().current
    if (project.chat_session_id !== sessionId) throw new Error('请先选择项目关联对话')
    const conversation = sessions.scope(sessionId)?.get('conversation')
    if (!conversation) throw new Error('项目对话尚未就绪')
    const current = await fetchProject(project.id)
    if (!current.production?.request || current.production.request.session_id !== sessionId) throw new Error('当前没有可继续的生成请求，请刷新项目')
    const value = await workflowAction(project.id, 'production-resume-request', { revision: current.production.revision, request_id: current.production.request.id, session_id: sessionId })
    try { await conversation.send(productionMessage(value)) }
    catch (error) {
      await workflowAction(project.id, 'production-request-error', { revision: value.production.revision, request_id: value.production.request.id, error: error.message }).catch(() => {})
      throw error
    }
    return value
  }
  const { ProjectWorkflow } = require('elysium/production-workflow')
  return { StoryModel, VideoModel, apply, generate, generateProduction, resumeProduction, restartProductionAction, useProductionSession, selectProject, watchSession, projectForSession, ProjectWorkflow, ProjectCreated }
} })
