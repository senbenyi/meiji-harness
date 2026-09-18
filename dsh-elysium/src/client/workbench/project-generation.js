// 职责：桥接当前 Harness 会话，并展示按阶段执行的项目工作流。
window.__ModuleLoader__.load({ id: 'elysium/project-generation', factory: require => {
  const { createElement: h, useEffect, useState, useRef } = require('react')
  const { workflowAction } = require('elysium/project-api')
  const { ProjectConfiguration } = require('elysium/project-configuration')
  const { DeliveryView, deliveryUrl } = require('elysium/delivery')
  const { assetUrl } = require('elysium/media-api')
  let sessions
  const mountedAt = Date.now(), opened = new Set()
  const openProject = id => window.dispatchEvent(new CustomEvent('elysium:open-project', { detail: { id } }))
  function ProjectCreated({ block, sessionId }) {
    let value
    for (const item of block?.content || []) try { const parsed = JSON.parse(item.text); value = parsed.output || parsed } catch {}
    useEffect(() => {
      if (!value?.id || !value.created_at || value.created_at < mountedAt || opened.has(value.id) || sessions?.list.getSnapshot().current !== sessionId) return
      opened.add(value.id); openProject(value.id)
    }, [value?.id, value?.created_at, sessionId])
    return value?.id ? h('button', { onClick: () => openProject(value.id) }, '请配置项目素材 · 打开项目') : null
  }
  function apply(ctx) {
    sessions = ctx.sessions
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
  async function generate(project, stage) {
    const sessionId = sessions?.list.getSnapshot().current
    const conversation = sessionId && sessions.scope(sessionId)?.get('conversation')
    if (!conversation) throw new Error('请先打开一个 Harness 会话，再点击下一步')
    const value = await workflowAction(project.id, 'request', { revision: project.workflow.revision, stage, session_id: sessionId })
    try {
      await conversation.send(`请执行项目 ${project.id} 的${stage === 'plot' ? '剧情' : '分镜'}生成步骤。request_id=${value.workflow.request.id}。先 project_generation_read 读取资料，再 project_generation_complete 保存结果；仅执行此阶段，不生成视频。`)
    } catch (error) { await workflowAction(project.id, 'cancel', { revision: value.workflow.revision }); throw error }
    return value
  }
  function ProjectWorkflow({ project, busy, run, guard }) {
    const [draft, setDraft] = useState(project), [plot, setPlot] = useState(project.workflow.plot || '')
    const [shots, setShots] = useState(project.acts.flatMap(act => act.shots)), [active, setActive] = useState(null)
    const [dirty, setDirty] = useState(false)
    const seen = useRef(project.workflow.stage), w = project.workflow
    useEffect(() => {
      if (dirty) return
      setDraft(project); setPlot(w.plot || ''); setShots(project.acts.flatMap(act => act.shots))
      if (seen.current !== w.stage) { setActive(current => current === null ? null : w.stage.startsWith('plot') ? 'plot' : w.stage.startsWith('storyboard') ? 'storyboard' : ['video', 'complete', 'failed', 'submitting'].includes(w.stage) ? 'video' : 'configuration'); seen.current = w.stage }
    }, [project.updated_at, dirty])
    useEffect(() => {
      if (!guard || !dirty) return
      const leave = next => { if (window.confirm('放弃未保存的项目修改？')) { setDirty(false); next() } }
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    const execute = async action => { const ok = await run(action); if (ok) setDirty(false); return ok }
    const action = (name, body = {}) => workflowAction(project.id, name, { revision: w.revision, ...body })
    const generating = Boolean(w.request), locked = busy || generating || ['video', 'submitting'].includes(w.stage)
    const configNext = async () => { if (await execute(async () => {
      const saved = await action('configure', { configuration: draft.configuration, brief: draft.brief, mode: draft.mode })
      return generate(saved, 'plot')
    })) setActive('plot') }
    const plotNext = async () => { if (await execute(async () => generate(await action('edit', { plot }), 'storyboard'))) setActive('storyboard') }
    const saveShots = async () => action('edit', { shots })
    const submit = async () => { if (await execute(async () => {
      const saved = dirty ? await saveShots() : project
      return workflowAction(project.id, 'submit', { revision: saved.workflow.revision })
    })) setActive('video') }
    const field = (label, value, change, rows = 3) => h('label', { className: 'elysium-field' }, label, h('textarea', { 'aria-label': label, value: value || '', rows, disabled: locked, onChange: event => { change(event.target.value); setDirty(true) } }))
    const navigate = page => {
      if (dirty && !window.confirm('放弃未保存的项目修改？')) return
      setDirty(false); setDraft(project); setPlot(w.plot || ''); setShots(project.acts.flatMap(act => act.shots)); setActive(page)
    }
    const materials = project.selected_materials || [], savedShots = project.acts.flatMap(act => act.shots)
    const duration = savedShots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0)
    const films = project.deliverables.filter(item => !['subtitle', 'srt', 'vtt'].includes(item.type))
    const materialName = field => materials.find(item => item.field === field)?.title || '未选择'
    const modeName = { director: '导演模式', free: '自由模式', teaching: '教学模式' }[project.mode] || '导演模式'
    const steps = [
      { key: 'configuration', title: '项目配置', status: w.revision ? '已配置' : '待配置', summary: `${modeName} · 已选 ${materials.length} 项素材`, detail: `男主：${materialName('male')} · 女主：${materialName('female')}`, note: `场景：${materialName('scene')}`, images: materials.filter(item => ['male', 'female', 'scene'].includes(item.field) && item.image_url) },
      { key: 'plot', title: '剧情', status: w.request?.stage === 'plot' ? '生成中' : w.plot_stale ? '待更新' : w.plot ? savedShots.length ? '已生成' : '待确认' : '待生成', summary: w.plot ? `${[...w.plot.replace(/\s/g, '')].length} 字 · 点击阅读与编辑` : '先完成项目配置，生成故事剧情', detail: w.plot || '让人物、场景与题材串成一个故事。', disabled: !w.plot && w.request?.stage !== 'plot' },
      { key: 'storyboard', title: '分镜', status: w.request?.stage === 'storyboard' ? '生成中' : savedShots.length ? w.storyboard_revision !== w.revision ? '待更新' : w.approval ? '已审核' : '待审核' : '待生成', summary: `${savedShots.length} 个镜头 · 预计 ${duration} 秒`, detail: savedShots.length ? savedShots.map(shot => shot.action).filter(Boolean).join(' / ') : '确认剧情后生成分镜，再人工审核画面与运镜。', images: savedShots.slice(0, 3).map(shot => materials.find(item => item.id === shot.reference_id && item.image_url)).filter(Boolean), disabled: !savedShots.length && w.request?.stage !== 'storyboard' },
      { key: 'video', title: '成片', status: ({ complete: '已完成', failed: '生成失败', video: '生成中', submitting: '提交中' })[w.stage] || '待提交', summary: films.length ? `${films.length} 份成片${films[0].duration_sec ? ` · ${films[0].duration_sec} 秒` : ''} · 点击播放` : '审核分镜后提交生成', detail: w.error || (w.job_id ? '查看视频任务状态和生成结果' : '完成前面的步骤，即可开始制作视频。'), disabled: !w.job_id && !films.length && w.stage !== 'failed' },
    ]
    const currentKey = w.stage.startsWith('plot') ? 'plot' : w.stage.startsWith('storyboard') ? 'storyboard' : ['video', 'submitting', 'complete', 'failed'].includes(w.stage) ? 'video' : 'configuration'
    const currentStep = steps.find(step => step.key === active)
    const notices = h('div', { className: 'elysium-workflow-notices' },
      w.error ? h('p', { role: 'alert' }, w.error) : null,
      generating ? h('p', { role: 'status' }, `AI 正在生成${w.request.stage === 'plot' ? '剧情' : '分镜'}，可在聊天区查看进度。`, h('button', { disabled: busy, onClick: () => execute(() => action('cancel')) }, '取消本次生成请求')) : null)
    if (active === null) return h('div', { className: 'elysium-project-overview' }, notices,
      h('p', { className: 'elysium-overview-hint' }, '创作流程', h('span', null, '选择一个步骤，查看或编辑详情')),
      steps.map((step, index) => h('button', { key: step.key, className: 'elysium-process-card', 'data-current': step.key === currentKey, disabled: step.disabled, onClick: () => navigate(step.key), 'aria-label': `打开${step.title}详情` },
        h('span', { className: 'elysium-process-card-heading' }, h('span', { className: 'elysium-step-number' }, String(index + 1).padStart(2, '0')), h('strong', null, step.title), h('span', { className: 'elysium-step-status' }, step.status), h('span', { 'aria-hidden': true }, '›')),
        h('span', { className: 'elysium-process-summary' }, step.summary),
        step.key === 'video' && films[0] && deliveryUrl(films[0]) ? h('video', { className: 'elysium-process-video', 'aria-label': '成片预览封面', src: films[0].job_id ? assetUrl('video', films[0].job_id) : deliveryUrl(films[0]), muted: true, playsInline: true, preload: 'metadata' }) : null,
        step.images?.length ? h('span', { className: 'elysium-process-previews' }, step.images.map((item, i) => h('span', { key: `${item.id}-${i}` }, h('img', { src: item.job_id ? assetUrl('image', item.job_id, { preview: '1' }) : item.image_url, alt: item.title, loading: 'lazy' }), h('span', null, item.title)))) : null,
        h('span', { className: 'elysium-process-description' }, step.detail), step.note ? h('span', { className: 'elysium-process-description' }, step.note) : null)))
    const content = active === 'configuration' ? h('div', null, h(ProjectConfiguration, { project: draft, busy: locked, onChange: value => { setDraft(value); setDirty(true) } }))
          : active === 'plot' ? h('div', null, w.plot_stale ? h('p', { role: 'alert' }, '素材已变化，当前剧情为旧版本。请检查修改并保存，或回到配置重新生成。') : null, w.plot ? field('剧情正文', plot, setPlot, 8) : h('p', null, '先配置素材并点击下一步生成剧情。'),
            h('p', null, `${[...plot.replace(/\s/g, '')].length}/200 字`))
          : active === 'storyboard' ? h('div', null,
            w.storyboard_revision !== w.revision && shots.length ? h('p', { role: 'alert' }, '剧情或素材已变化，请回到剧情重新生成分镜。') : null,
            h('p', null, `${shots.length} 镜 · 共 ${shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0)} 秒。请审核后提交。`),
            shots.map((shot, i) => {
              const patch = value => { setShots(current => current.map((item, index) => index === i ? { ...item, ...value } : item)); setDirty(true) }
              return h('article', { className: 'elysium-shot-editor', key: shot.id }, h('h3', null, `镜头 ${i + 1}`),
                h('label', { className: 'elysium-field' }, '时长（秒）', h('input', { type: 'number', min: 1, max: 15, value: shot.duration, disabled: locked, onChange: event => patch({ duration: Number(event.target.value) }) })),
                ...[['action', '故事动作'], ['framing', '景别'], ['camera', '运镜'], ['lighting', '光线'], ['sound', '声音'], ['subtitle', '对白'], ['prompt', '生成描述']].map(([key, title]) => h('div', { key }, field(`${title} ${i + 1}`, shot[key], value => patch({ [key]: value })))),
                ...[['characters', '出场人物', ['male', 'female', 'supporting'], true], ['props', '镜头道具', ['props'], true], ['scene', '镜头场景', ['scene'], false]].map(([key, title, fields, multiple]) => h('label', { key, className: 'elysium-field' }, title,
                  h('select', { 'aria-label': `${title} ${i + 1}`, multiple, size: multiple ? 3 : undefined, value: multiple ? shot[key] || [] : shot[key] || '', disabled: locked,
                    onChange: event => patch({ [key]: multiple ? [...event.target.selectedOptions].map(option => option.value) : event.target.value }) },
                    !multiple ? h('option', { value: '' }, '无') : null,
                    (project.selected_materials || []).filter(item => fields.includes(item.field)).map(item => h('option', { key: `${item.field}-${item.id}`, value: item.id }, item.title))))),
                h('label', { className: 'elysium-field' }, '镜头方式', h('select', { value: shot.mode, disabled: locked, onChange: event => patch({ mode: event.target.value, ...(event.target.value === 'continue' ? { reference_id: '' } : {}) }) }, h('option', { value: 'independent' }, '独立镜头'), i ? h('option', { value: 'continue' }, '续接上一镜') : null)),
                h('label', { className: 'elysium-field' }, '画面参考图（单选）', h('select', { value: shot.reference_id || '', disabled: locked || shot.mode === 'continue', onChange: event => patch({ reference_id: event.target.value }) }, h('option', { value: '' }, '无'), (project.selected_materials || []).filter(item => item.image_url).map(item => h('option', { key: `${item.field}-${item.id}`, value: item.id }, item.title)))))
            }))
          : h('div', null, h('p', { role: 'status' }, w.stage === 'complete' ? '视频已完成' : w.stage === 'failed' ? '视频生成失败' : w.job_id ? '视频生成中…' : '审核分镜后点击提交，开始生成视频。'),
            w.stage === 'failed' ? h('button', { disabled: busy, onClick: () => execute(() => action('retry')) }, '恢复原视频任务') : null,
            h(DeliveryView, { project }))
    const actions = active === 'configuration' ? [
      h('button', { key: 'save', disabled: locked, onClick: () => execute(() => action('configure', { configuration: draft.configuration, brief: draft.brief, mode: draft.mode })) }, '保存配置'),
      h('button', { key: 'next', className: 'elysium-primary', disabled: locked, onClick: configNext }, '下一步：生成剧情'),
    ] : active === 'plot' ? [
      h('button', { key: 'save', disabled: locked || !plot.trim(), onClick: () => execute(() => action('edit', { plot })) }, '保存剧情'),
      h('button', { key: 'next', className: 'elysium-primary', disabled: locked || !plot.trim(), onClick: plotNext }, '下一步：生成分镜'),
    ] : active === 'storyboard' ? [
      h('button', { key: 'save', disabled: locked || !shots.length || w.storyboard_revision !== w.revision, onClick: () => execute(saveShots) }, '保存分镜'),
      h('button', { key: 'next', className: 'elysium-primary', disabled: locked || !shots.length || w.storyboard_revision !== w.revision, onClick: submit }, '审核通过，生成视频'),
    ] : h('button', { onClick: () => navigate(null) }, '返回项目总览')
    return h('div', { className: 'elysium-project-workflow elysium-step-detail' },
      h('header', { className: 'elysium-step-detail-header' }, h('button', { onClick: () => navigate(null) }, '← 项目总览'), h('strong', null, currentStep.title), h('span', { className: 'elysium-step-status' }, currentStep.status)),
      h('div', { className: 'elysium-step-detail-body', key: active }, notices, content),
      h('footer', { className: 'elysium-step-detail-footer' }, actions))

  }
  return { apply, generate, ProjectWorkflow, ProjectCreated }
} })
