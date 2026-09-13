window.__ModuleLoader__.load({
  id: 'elysium-tools/media-api', factory: () => {
    function mediaUrl(kind, sessionId, callId, params = {}, baseKey = 'base') {
      const config = window.__ELYSIUM_MEDIA__
      if (!config?.token || !config[baseKey]) throw new Error('媒体服务未加载，请刷新页面或检查媒体服务')
      const query = new URLSearchParams(params)
      if (sessionId) query.set('session', sessionId)
      if (callId) query.set('call', callId)
      query.set('t', config.token)
      // Relative to the page origin: SSH tunnel ports must never be hard-coded.
      return `${config[baseKey]}/${kind}?${query}`
    }
    async function readStatus(sessionId, callId, signal, retry = true) {
      const response = await fetch(mediaUrl('status', sessionId, callId), { signal, cache: 'no-store', credentials: 'same-origin' })
      if (response.status === 401 && retry) {
        const refreshed = await fetch(`${window.__ELYSIUM_MEDIA__.base}/credentials`, {
          signal, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Elysium-Media-Refresh': '1' },
        })
        if (refreshed.ok) {
          const config = await refreshed.json()
          if (config.token && config.base === window.__ELYSIUM_MEDIA__.base) {
            window.__ELYSIUM_MEDIA__ = config
            return readStatus(sessionId, callId, signal, false)
          }
        }
      }
      const value = await response.json()
      if (!response.ok) {
        const error = new Error(value.error || '任务状态读取失败')
        error.status = response.status
        throw error
      }
      return value
    }
    const projectUrl = (kind, params) => mediaUrl(kind, null, null, params, 'projectBase')
    return { mediaUrl, readStatus, projectUrl }
  },
})

window.__ModuleLoader__.load({
  id: 'elysium-tools/media-model', factory: () => {
    function fromBlock(block) {
      for (const item of block?.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          const result = value.output || value
          if (result.job_id && result.status) return { ...result, media_kind: 'video' }
        } catch { /* The generic result remains available in details. */ }
      }
      if (block?.isError) {
        const error = (block.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
        // These validation errors occur before startVideoJob creates any job or worker.
        if (/MODEL_INPUT_INVALID|包含未支持的工作流参数/.test(error)) {
          return { status: 'rejected', error }
        }
        return { status: 'interrupted' }
      }
      return { status: 'pending' }
    }
    const stages = { reconnecting: '连接中断，正在重试原视频', prepare: '准备素材', submit: '提交任务', queued: '排队中', execute: '工作流执行中', reconcile: '核对原任务', 'inspect-output': '校验产物', completed: '已完成' }
    function label(job) {
      if (job.status === 'succeeded') return '已完成'
      if (job.status === 'failed') return job.remote_status === 'succeeded' ? '产物待校验' : job.error_code === 'LOCAL_WORKER_STOPPED' || job.error_code === 'WORKER_NOT_RUNNING' ? '本地处理已停止' : '任务未完成'
      if (job.status === 'interrupted') return '等待已中断，正在核对后台任务'
      if (job.status === 'pending') return '正在创建任务'
      if (job.status === 'rejected') return '参数未通过，未创建任务'
      return stages[job.stage] || (job.status === 'queued' ? '排队中' : '制作中')
    }
    function specificationLabel(job) {
      const spec = job.specification, info = job.media_info
      const parts = [], profile = { preview: '预览档', regular: '常规档', 'high-quality': '高清档', standard: '原工作流' }[job.profile]
      if (profile) parts.push(profile)
      const width = info?.width || spec?.width, height = info?.height || spec?.height
      if (width && height) parts.push(`${width}×${height}`)
      const seconds = info?.duration_seconds ?? spec?.seconds
      if (Number.isFinite(seconds)) parts.push(`约 ${Number(seconds.toFixed(1))} 秒视频`)
      if (Number.isFinite(spec?.steps)) parts.push(`${spec.steps} 步`)
      if (info?.has_audio !== undefined) parts.push(info.has_audio ? '带音频' : '无音频')
      else if (spec?.audio === 'joint-generation-and-decoding') parts.push('带音频')
      return parts.join('、')
    }
    return { fromBlock, label, specificationLabel }
  },
})

window.__ModuleLoader__.load({
  id: 'elysium-tools/media-styles', factory: () => ({
    apply() {
      if (typeof document === 'undefined') return
      const id = 'elysium-media-styles'
      if (document.getElementById(id)) return
      const style = document.createElement('style')
      style.id = id
      style.textContent = `
.elysium-download { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--media-muted); cursor: pointer; text-decoration: none; }
.elysium-download:hover { color: var(--dsw-alias-label-primary, #fff); }
.elysium-card { --media-muted: var(--dsw-alias-label-secondary, #a3a3a3); box-sizing: border-box; width: 100%; margin: 8px 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l2, #ffffff1a); border-radius: 16px; color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 13px; line-height: 1.5; }
.elysium-preview { position: relative; overflow: hidden; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, #8881); }
.elysium-preview > video, .elysium-preview > img { display: block; width: 100%; height: 100%; object-fit: contain; }
.elysium-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--media-muted); font-size: 12px; background: var(--dsw-alias-bg-base, #171717); }
.elysium-spinner { width: 22px; height: 22px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: elysium-spin 1s linear infinite; }
@keyframes elysium-spin { to { transform: rotate(360deg); } }
.elysium-card button, .elysium-card a { font: inherit; }
.elysium-control { position: absolute; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid #ffffff20; border-radius: 8px; background: #0007; color: #fff; cursor: pointer; backdrop-filter: blur(8px); transition: background .15s; }
.elysium-control:hover { background: #000b; }
.elysium-control:focus-visible, .elysium-details > summary:focus-visible, .elysium-text-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.elysium-play { top: 50%; left: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; border-radius: 50%; }
.elysium-expand { bottom: 10px; right: 10px; }
.elysium-info { padding: 10px 4px 4px; }
.elysium-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.elysium-heading strong { font-size: 14px; font-weight: 500; }
.elysium-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-top: 3px; color: var(--media-muted); font-size: 12px; line-height: 1.5; font-variant-numeric: tabular-nums; }
.elysium-details { flex-basis: 100%; font-size: 12px; overflow-wrap: anywhere; }
.elysium-details > summary { cursor: pointer; list-style: none; color: var(--media-muted); }
.elysium-details > summary::-webkit-details-marker { display: none; }
.elysium-details > summary::after { content: '⌄'; display: inline-block; margin-left: 4px; }
.elysium-details[open] > summary::after { transform: rotate(180deg); }
.elysium-details p { margin: 8px 0 0; font-size: 12px; }
.elysium-text-button { padding: 0; border: 0; background: none; color: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.elysium-error { margin: 8px 0 0; font-size: 12px; color: var(--media-muted); overflow-wrap: anywhere; }
.elysium-dialog { max-width: 92vw; max-height: 92vh; margin: auto; padding: 6px; border: 1px solid #ffffff20; border-radius: 14px; background: #111; color: #fff; }
.elysium-dialog::backdrop { background: #000b; backdrop-filter: blur(4px); }
.elysium-dialog video { display: block; max-width: 88vw; max-height: 88vh; border-radius: 8px; }
.elysium-close { top: 12px; right: 12px; z-index: 1; border-radius: 50%; }
@media (hover: hover) { .elysium-expand { opacity: 0; transition: opacity .15s; } .elysium-preview:hover .elysium-control, .elysium-preview:focus-within .elysium-control { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .elysium-spinner { animation: none; } .elysium-control { transition: none; } }
`
      document.head.appendChild(style)
    },
  }),
})

window.__ModuleLoader__.load({
  id: 'elysium-tools/media-card', factory: require => {
    const { createElement: h, useEffect, useState, useRef } = require('react')
    const { readStatus, mediaUrl } = require('elysium-tools/media-api')
    const { fromBlock, label, specificationLabel } = require('elysium-tools/media-model')
    function MediaTaskCard({ sessionId, callId, block, inspect, toolName, ordinal }) {
      const [expanded, setExpanded] = useState(false)
      const [mediaReady, setMediaReady] = useState(false)
      const [dimensions, setDimensions] = useState(null)
      const dialog = useRef(null)
      useEffect(() => {
        if (expanded) dialog.current?.showModal()
      }, [expanded])
      const fallback = fromBlock(block)
      const [job, setJob] = useState(fallback)
      const [error, setError] = useState('')
      const [attempt, setAttempt] = useState(0)
      const [playbackError, setPlaybackError] = useState(false)
      useEffect(() => {
        if (fallback.status === 'rejected') return
        let active = true, timer, failures = 0
        const controller = new AbortController()
        setJob(fromBlock(block)); setError(''); setPlaybackError(false)
        if (fallback.status === 'succeeded' && fallback.comfyui_view_url) return
        async function poll() {
          let delay = 3000
          try {
            const current = await readStatus(sessionId, callId, controller.signal)
            if (!active) return
            const value = current.status === 'pending' && fallback.status !== 'pending' ? fallback : current
            setJob(value); setError(''); failures = 0
            if (value.status === 'succeeded') return
            if (value.status === 'failed') delay = 30000
            if (value.status === 'interrupted') { setError('无法关联后台任务，请查看详情中的任务 ID'); return }
          } catch (err) {
            if (!active) return
            setError(err.message)
            if (err.status === 401) return
            delay = Math.min(30000, 3000 * 2 ** ++failures)
          }
          if (active) timer = setTimeout(poll, delay)
        }
        poll()
        return () => { active = false; controller.abort(); clearTimeout(timer) }
      }, [sessionId, callId, block, attempt])
      const kind = 'video', title = '视频'
      let video
      if (job.status === 'succeeded') {
        if (job.comfyui_view_url) video = job.comfyui_view_url
        else try { video = mediaUrl(kind, sessionId, callId) } catch { video = job.comfyui_view_url }
      }
      useEffect(() => { setMediaReady(false) }, [video, attempt])
      if (fallback.status === 'rejected') return h('details', { 'aria-label': '媒体提交记录' },
        h('summary', null, '媒体参数校验未通过（未创建任务）'),
        h('p', null, fallback.error), inspect ? h('button', { onClick: inspect }, '查看执行记录') : null)
      let args = {}
      try { args = JSON.parse(block?.call?.argsRaw || block?.argsRaw || '{}') } catch { /* Dimensions arrive with the result if arguments are incomplete. */ }
      const info = job.media_info
      const actual = dimensions?.src === video ? dimensions : null
      const width = actual?.width || info?.width || job.specification?.width || args.width || 480
      const height = actual?.height || info?.height || job.specification?.height || args.height || 854
      const specification = specificationLabel(job)
      const loading = !video && !error && ['pending', 'queued', 'running'].includes(job.status)
      const busy = loading || (video && !mediaReady && !playbackError)
      const icon = name => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: name === 'play' ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: { download: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2', play: 'M9 5 19 12 9 19Z', expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5', close: 'm6 6 12 12M18 6 6 18' }[name] }))
      return h('section', { 'aria-label': `${title}任务`, className: 'elysium-card', style: { maxWidth: height > width ? 300 : 560 } },
        h('div', { className: 'elysium-preview', style: { aspectRatio: `${width} / ${height}` } },
          video ? h('video', { key: video + attempt, src: video,
            onLoadedMetadata: event => {
              const { videoWidth, videoHeight } = event.currentTarget
              if (videoWidth > 0 && videoHeight > 0) setDimensions({ src: video, width: videoWidth, height: videoHeight })
            },
            onLoadedData: () => setMediaReady(true), onLoad: () => setMediaReady(true),
            controls: false, muted: true, preload: 'metadata',
          onError: async () => {
            if (job.comfyui_view_url) { setPlaybackError(true); return }
            try {
              const current = await readStatus(sessionId, callId)
              if (mediaUrl(kind, sessionId, callId) !== video) { setJob(current); setPlaybackError(false); return }
            } catch { /* Report a playback failure if credentials cannot be recovered. */ }
            setPlaybackError(true)
          }
          }) : null,
          busy ? h('div', { className: 'elysium-placeholder', role: 'progressbar', 'aria-label': loading ? `${title}生成中` : '媒体加载中' },
            h('span', { className: 'elysium-spinner', 'aria-hidden': true }),
            h('span', { role: 'status', 'aria-live': 'polite' }, loading ? label(job) : '加载预览')) : null,
          !video && !busy ? h('div', { className: 'elysium-placeholder' }, job.status === 'failed' ? label(job) : '预览暂不可用') : null,
          video && mediaReady ? h('button', { className: 'elysium-control elysium-play', 'aria-label': '播放视频', onClick: () => setExpanded(true) }, icon('play')) : null,
          video ? h('button', { className: 'elysium-control elysium-expand', 'aria-label': '放大查看', title: '放大查看', onClick: () => setExpanded(true) }, icon('expand')) : null),
        h('div', { className: 'elysium-info' },
          h('div', { className: 'elysium-heading' }, h('strong', null, ordinal ? `${title} ${String(ordinal).padStart(2, '0')}` : title),
            video && mediaReady ? h('a', { href: mediaUrl('download', sessionId, callId), download: '', className: 'elysium-download', 'aria-label': '下载视频', title: '下载视频' }, icon('download')) : null),
          h('div', { className: 'elysium-meta' },
            info ? h('span', null, `${info.duration_seconds} 秒 · ${info.width} × ${info.height} · ${info.frame_rate} fps`) : null,
            h('details', { className: 'elysium-details' }, h('summary', null, '详情'),
              job.job_id ? h('p', null, '任务 ID：', h('code', null, job.job_id)) : null,
              Number.isFinite(job.timings?.total_ms) ? h('p', null, `任务耗时：${(job.timings.total_ms / 1000).toFixed(1)} 秒`) : null,
              specification ? h('p', null, `生成规格：${specification}`) : null,
              inspect ? h('button', { className: 'elysium-text-button', onClick: inspect }, '执行记录') : null)),
          error ? h('p', { className: 'elysium-error', role: 'alert' }, error, ' ', h('button', { className: 'elysium-text-button', onClick: () => setAttempt(n => n + 1) }, '重新连接')) : null,
          job.status === 'failed' ? h('p', { className: 'elysium-error', role: 'alert' }, job.error || '任务失败，可查看执行记录。') : null,
          playbackError ? h('p', { className: 'elysium-error', role: 'alert' }, '预览加载失败 ', h('button', { className: 'elysium-text-button', onClick: () => setAttempt(n => n + 1) }, '重试播放')) : null),
        expanded && video ? h('dialog', { ref: dialog, className: 'elysium-dialog', 'aria-label': '视频预览', onClose: () => setExpanded(false),
          onClick: event => { if (event.target === event.currentTarget) setExpanded(false) } },
          h('button', { autoFocus: true, className: 'elysium-control elysium-close', 'aria-label': '关闭', onClick: () => setExpanded(false) }, icon('close')),
          h('video', { src: video, controls: true, autoPlay: true })) : null)
    }
    return { MediaTaskCard, apply(ctx) {
      require('elysium-tools/media-styles').apply()
      ctx.slots.inject('tool.call.toolview', () => {
        for (const key of ['workflow_generate_video', 'workflow_resume_video']) ctx.slots.register({ name: 'tool.call.toolview', key }, props => fromBlock(props.block).status === 'succeeded'
          ? h('span', { style: { fontSize: 13, opacity: 0.65 } }, '媒体已生成 · 作品见本轮回复下方')
          : h(MediaTaskCard, props))
      })
    } }
  },
})

window.__ModuleLoader__.load({
  id: 'elysium-tools/media-results', factory: require => {
    const { createElement: h } = require('react')
    const { MediaTaskCard } = require('elysium-tools/media-card')
    const { fromBlock } = require('elysium-tools/media-model')
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

window.__ModuleLoader__.load({
  id: 'elysium-tools/creation-commands', factory: () => {
    const commands = [
      { name: '预览创作', description: '快速看构图和动作，生成约 3 秒预览' },
      { name: '常规创作', description: '清晰度与速度兼顾，单次生成视频，时长按需' },
      { name: '高清创作', description: '更高分辨率，适合正式制作，等待较长' },
    ]
    function claim(command) {
      return { claim: {
        token: `/${command.name} `,
        hint: '描述人物、场景和动作；有参考图时粘贴作品地址',
        images: false,
        async submit(args, actx, images = []) {
          if (!args.trim()) return { kind: 'error', text: '请先填写创作内容，再发送。' }
          if (images.length) return { kind: 'error', text: '请使用服务器上的作品地址作为参考图。' }
          await actx.get('conversation').send(`【${command.name}】\n${args.trim()}`)
          return { kind: 'success' }
        },
      } }
    }
    const source = {
      trigger: '/', name: '创作指令', order: -100,
      async candidates(_session, request) {
        if (request.position !== 'leading') return []
        return commands.filter(command => command.name.includes(request.query.trim()))
      },
      onPick(pick) {
        const command = commands.find(command => command.name === pick.candidate.name)
        if (pick.position === 'leading' && command) return claim(command)
      },
      matchSpace(_session, token) {
        const command = commands.find(command => token === `/${command.name}`)
        if (command) return claim(command)
      },
      async matchEnter(_session, line) {
        const command = commands.find(command => line === `/${command.name}` || line.startsWith(`/${command.name} `))
        if (command) return claim(command)
      },
    }
    return { source, apply(ctx) { ctx.effect(() => ctx.inputTriggers.registerSource(source), 'elysium: Chinese creation commands') } }
  },
})

window.__ModuleLoader__.load({ id: 'elysium-tools/panel-styles', factory: require => { const exports = {}
  exports.apply = () => {
    const style = document.createElement('style')
    style.textContent = `
.elysium-panel { position: fixed; top: 52px; right: 0; bottom: 0; z-index: 100; display: flex; flex-direction: column; box-sizing: border-box; background: var(--dsw-alias-background-primary, #202020); color: var(--dsw-alias-label-primary, #eee); border-left: 1px solid #8885; font: 13px/1.5 system-ui; }
.elysium-panel-header { display: flex; padding: 10px; gap: 6px; border-bottom: 1px solid #8885; }
.elysium-panel-body { overflow: auto; flex: 1; padding: 12px; }
.elysium-panel-toggle { position: fixed; right: 16px; top: 12px; z-index: 101; }
.elysium-panel-resize { position: absolute; left: -4px; width: 8px; top: 0; bottom: 0; cursor: ew-resize; }
.elysium-panel button, .elysium-panel-toggle { border: 1px solid #8885; border-radius: 6px; padding: 5px 8px; background: var(--dsw-alias-background-primary, #303030); color: inherit; cursor: pointer; }
.elysium-panel button:disabled { opacity: .5; cursor: wait; }
.elysium-panel-tab-active { font-weight: bold; text-decoration: underline; }
.elysium-asset-item { padding: 10px 0; border-bottom: 1px solid #8884; overflow-wrap: anywhere; }
.elysium-asset-thumb { width: 100%; max-height: 160px; object-fit: contain; background: #0003; }
.elysium-panel a { color: #8bcaff; }
.elysium-panel input, .elysium-panel textarea { box-sizing: border-box; width: 100%; margin: 4px 0; background: transparent; color: inherit; border: 1px solid #8887; padding: 5px; }
.elysium-act { margin: 10px 0; border: 1px solid #8884; padding: 6px; }
.elysium-act-header { width: 100%; text-align: left; }
.elysium-act-collapsed { padding-bottom: 6px; }
.elysium-shot { padding: 10px 0; border-top: 1px solid #8884; overflow-wrap: anywhere; }
.elysium-shot-role .elysium-asset-thumb { max-height: 70px; width: 80px; display: block; }
.elysium-shot-status { margin-left: 8px; color: #aaa; }
.elysium-filter-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.elysium-filter-select { max-width: 100%; background: var(--dsw-alias-background-primary, #303030); color: inherit; padding: 5px; }
.elysium-import-btn { margin-left: 6px; }
.elysium-panel-actions { display: flex; gap: 4px; flex-wrap: wrap; }
`
    document.head.appendChild(style)
    return () => style.remove()
  }
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/asset-list', factory: require => { const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { mediaUrl } = require('elysium-tools/media-api')
  const { specificationLabel } = require('elysium-tools/media-model')
  const assetUrl = (kind, job) => mediaUrl(kind, null, null, { job })
  async function fetchAssets(offset = 0, limit = 50, filters = {}) {
    const response = await fetch(mediaUrl('list', null, null, { offset, limit, ...filters }), { cache: 'no-store', credentials: 'same-origin' })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '素材读取失败')
    return value
  }
  function relativeTime(time) {
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
    return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`
  }
  function MaterialItems({ filters, onSelect }) {
    const [items, setItems] = useState([]), [more, setMore] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const [importJob, setImportJob] = useState(null)
    const sentinel = useRef(null), loading = useRef(false), alive = useRef(false)
    async function load() {
      if (loading.current || !more) return
      loading.current = true; setBusy(true); setError('')
      try {
        const data = await fetchAssets(items.length, 50, filters)
        if (alive.current) { setItems(previous => [...previous, ...data.items]); setMore(data.has_more) }
      } catch (err) { if (alive.current) setError(err.message) }
      finally { loading.current = false; if (alive.current) setBusy(false) }
    }
    useEffect(() => { alive.current = true; load(); return () => { alive.current = false } }, [])
    useEffect(() => {
      if (!more || error || busy || typeof IntersectionObserver === 'undefined') return
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load() })
      if (sentinel.current) observer.observe(sentinel.current)
      return () => observer.disconnect()
    }, [items, more, error, busy])
    return h('div', null,
      items.map((item, index) => h('article', { key: item.job_id, className: 'elysium-asset-item' },
        item.has_video ? h('video', { className: 'elysium-asset-thumb', src: assetUrl('video', item.job_id), preload: 'metadata', controls: true }) : item.has_image ? h('img', { className: 'elysium-asset-thumb', src: assetUrl('image', item.job_id), alt: '生成图片' }) : null,
        h('div', null, `${index + 1}. ${specificationLabel(item) || '已完成素材'}`), h('small', null, relativeTime(item.created_at)), ' ',
        item.has_video || item.has_image ? h('a', { href: assetUrl('download', item.job_id), download: '' }, '下载') : null,
        h('button', { className: 'elysium-import-btn', onClick: () => onSelect ? onSelect(item) : setImportJob(item.job_id) }, onSelect ? '选择' : '→项目'))),
      importJob ? h(require('elysium-tools/project').ProjectPicker, { jobId: importJob, close: () => setImportJob(null) }) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      !busy && !items.length && !error ? h('p', null, '暂无已完成素材') : null,
      more ? h('button', { ref: sentinel, disabled: busy, onClick: load }, busy ? '加载中…' : error ? '重试' : '加载更多') : null)
  }
  function MaterialList({ onSelect } = {}) {
    const [profile, setProfile] = useState(''), [media_kind, setKind] = useState('')
    const select = (label, value, change, options) => h('select', { className: 'elysium-filter-select', 'aria-label': label, value, onChange: event => change(event.target.value) }, options.map(([value, text]) => h('option', { key: value, value }, text)))
    return h('div', null,
      h('div', { className: 'elysium-filter-bar' },
        select('档次', profile, setProfile, [['', '全部档次'], ['preview', '预览'], ['regular', '常规'], ['high-quality', '高清']]),
        select('类型', media_kind, setKind, [['', '全部类型'], ['video', '视频'], ['image', '图片']])),
      h(MaterialItems, { key: `${profile}:${media_kind}`, filters: { profile, media_kind }, onSelect }))
  }
  Object.assign(exports, { MaterialList, fetchAssets, assetUrl, relativeTime })
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/project', factory: require => { const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { projectUrl } = require('elysium-tools/media-api')
  const { assetUrl, relativeTime, MaterialList } = require('elysium-tools/asset-list')
  const profiles = { preview: '预览', regular: '常规', 'high-quality': '高清' }
  async function request(action, body, params = {}) {
    const response = await fetch(projectUrl(action, params), { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '项目操作失败')
    return value
  }
  const fetchProjects = () => request('list')
  const fetchProject = id => request('get', null, { id })
  const createProject = (title, profile) => request('create', { title, profile })
  const updateProject = (id, patch) => request('update', { ...patch, id })
  const deleteProject = id => request('delete', { id })
  const importMaterial = (id, jobId, as = 'anchor', role) => request('import', { id, job_id: jobId, as, ...(role ? { role } : {}) })
  function Field({ value, label, save, multiline, disabled }) {
    const [draft, setDraft] = useState(value)
    useEffect(() => setDraft(value), [value])
    return h(multiline ? 'textarea' : 'input', { 'aria-label': label, placeholder: label, value: draft, disabled,
      onChange: event => setDraft(event.target.value), onBlur: () => { if (draft !== value) save(draft) } })
  }
  function ShotPreview({ jobId }) {
    const [job, setJob] = useState(null), [error, setError] = useState('')
    useEffect(() => {
      let active = true
      setJob(null); setError('')
      if (jobId) fetch(assetUrl('status', jobId), { cache: 'no-store', credentials: 'same-origin' })
        .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value })
        .then(value => { if (active) setJob(value) }).catch(err => { if (active) setError(err.message) })
      return () => { active = false }
    }, [jobId])
    if (error) return h('p', { role: 'alert' }, error)
    return job?.has_video ? h('video', { className: 'elysium-asset-thumb', src: assetUrl('video', jobId), preload: 'metadata', controls: true }) : job?.has_image ? h('img', { className: 'elysium-asset-thumb', src: assetUrl('image', jobId), alt: '镜头图片' }) : h('p', null, jobId ? '暂无可播放产物' : '尚未关联素材')
  }
  function ProjectPicker({ jobId, close }) {
    const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    useEffect(() => { let active = true; fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [])
    async function choose(id) {
      setBusy(true); setError('')
      try { await importMaterial(id, jobId); close() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    return h('section', { role: 'dialog', 'aria-label': '选择项目' }, h('strong', null, '引入为项目锚点'),
      items.map(item => h('button', { key: item.id, disabled: busy, onClick: () => choose(item.id) }, item.title)),
      !items.length ? h('p', null, '请先在项目标签页新建项目') : null,
      error ? h('p', { role: 'alert' }, error) : null, h('button', { disabled: busy, onClick: close }, '取消'))
  }
  function AnchorView({ project, save, run, busy }) {
    const [selecting, setSelecting] = useState(null)
    const change = (index, patch) => save({ anchors: project.anchors.map((anchor, i) => i === index ? { ...anchor, ...patch } : anchor) })
    return h('div', null,
      project.anchors.map((anchor, index) => h('article', { key: index, className: 'elysium-asset-item' },
        h(Field, { value: anchor.role, label: '锚点角色 ID', disabled: busy, save: role => save({ anchors: project.anchors.map((item, i) => i === index ? { ...item, role } : item), acts: project.acts.map(act => ({ ...act, shots: act.shots.map(shot => shot.role === anchor.role ? { ...shot, role } : shot) })) }) }),
        h(Field, { value: anchor.label, label: '锚点名称', disabled: busy, save: label => change(index, { label }) }),
        h(Field, { value: anchor.description, label: '锚点描述', multiline: true, disabled: busy, save: description => change(index, { description }) }),
        anchor.image_url ? h('img', { src: anchor.image_url, className: 'elysium-asset-thumb', alt: anchor.label }) : anchor.source?.job_id ? h(ShotPreview, { jobId: anchor.source.job_id }) : null,
        h(Field, { value: anchor.image_url, label: '参考图服务器 URL', disabled: busy, save: image_url => change(index, { image_url, source: null }) }),
        h('button', { disabled: busy, onClick: () => setSelecting(anchor.role) }, '替换'),
        h('button', { disabled: busy, onClick: () => setSelecting(anchor.role) }, '从素材选择'))),
      selecting !== null ? h('section', { role: 'dialog', 'aria-label': '选择锚点素材' },
        h(MaterialList, { onSelect: item => run(async () => { const value = await importMaterial(project.id, item.job_id, 'anchor', selecting); setSelecting(null); return value }) }),
        h('button', { disabled: busy, onClick: () => setSelecting(null) }, '取消')) : null,
      h('button', { disabled: busy, onClick: () => {
        let number = project.anchors.length + 1
        while (project.anchors.some(anchor => anchor.role === `role-${number}`)) number++
        save({ anchors: [...project.anchors, { role: `role-${number}`, label: '新锚点', description: '', source: null, image_url: '' }] })
      } }, '添加锚点'))
  }
  const statuses = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败' }
  function StoryboardView({ project, save, busy }) {
    const [collapsed, setCollapsed] = useState({})
    const changeAct = (index, patch) => save({ acts: project.acts.map((act, i) => i === index ? { ...act, ...patch } : act) })
    const changeShot = (actIndex, index, patch) => changeAct(actIndex, { shots: project.acts[actIndex].shots.map((shot, i) => i === index ? { ...shot, ...patch } : shot) })
    function move(actIndex, index, direction) {
      const shots = [...project.acts[actIndex].shots]
      ;[shots[index], shots[index + direction]] = [shots[index + direction], shots[index]]
      changeAct(actIndex, { shots })
    }
    function removeAct(index) {
      if (!window.confirm(`删除幕“${project.acts[index].title}”及其中所有镜头？`)) return
      setCollapsed({})
      save({ acts: project.acts.filter((_, i) => i !== index) })
    }
    return h('div', null,
      project.acts.map((act, actIndex) => h('section', { key: actIndex, className: `elysium-act${collapsed[actIndex] ? ' elysium-act-collapsed' : ''}` },
        h('button', { className: 'elysium-act-header', 'aria-expanded': !collapsed[actIndex], onClick: () => setCollapsed(value => ({ ...value, [actIndex]: !value[actIndex] })) }, `${collapsed[actIndex] ? '▸' : '▾'} ${act.title} · ${act.shots.length} 镜 · ${act.shots.filter(shot => shot.status === 'succeeded').length} 完成`),
        !collapsed[actIndex] ? h('div', null,
          h(Field, { value: act.title, label: '幕标题', disabled: busy, save: title => changeAct(actIndex, { title }) }),
          h('button', { disabled: busy, onClick: () => removeAct(actIndex) }, '删除幕'),
          act.shots.map((shot, index) => {
            const anchor = project.anchors.find(item => item.role === shot.role)
            const number = project.acts.slice(0, actIndex).reduce((total, item) => total + item.shots.length, 0) + index + 1
            return h('article', { key: index, className: 'elysium-shot' },
              h('strong', null, `镜 ${String(number).padStart(3, '0')}`),
              h('span', { className: 'elysium-shot-status' }, statuses[shot.status]),
              h('div', { className: 'elysium-shot-role' }, anchor ? h('div', null,
                h('span', null, anchor.label || anchor.role),
                anchor.image_url ? h('img', { className: 'elysium-asset-thumb', src: anchor.image_url, alt: anchor.label }) : anchor.source?.job_id ? h(ShotPreview, { jobId: anchor.source.job_id }) : null,
                h('small', null, anchor.description)) : shot.role ? h('span', null, `${shot.role}（锚点不存在）`) : null),
              h('select', { 'aria-label': '镜头角色', value: shot.role, disabled: busy, onChange: event => changeShot(actIndex, index, { role: event.target.value }) },
                h('option', { value: '' }, '无角色'),
                shot.role && !anchor ? h('option', { value: shot.role }, shot.role) : null,
                project.anchors.map(item => h('option', { key: item.role, value: item.role }, item.label || item.role))),
              h(Field, { value: shot.action, label: '动作描述', multiline: true, disabled: busy, save: action => changeShot(actIndex, index, { action }) }),
              h(Field, { value: shot.subtitle, label: '字幕', disabled: busy, save: subtitle => changeShot(actIndex, index, { subtitle }) }),
              h(Field, { value: shot.mode, label: '生成模式', disabled: busy, save: mode => changeShot(actIndex, index, { mode }) }),
              h(ShotPreview, { jobId: shot.job_id }),
              h(Field, { value: shot.job_id || '', label: '关联任务 ID', disabled: busy, save: job_id => changeShot(actIndex, index, { job_id: job_id.trim() || null, status: 'pending' }) }),
              h('select', { 'aria-label': '镜头状态', value: shot.status, disabled: busy, onChange: event => changeShot(actIndex, index, { status: event.target.value }) }, Object.entries(statuses).map(([value, text]) => h('option', { key: value, value }, text))),
              h(Field, { value: shot.notes, label: '镜头备注', multiline: true, disabled: busy, save: notes => changeShot(actIndex, index, { notes }) }),
              h('div', { className: 'elysium-panel-actions' },
                h('button', { disabled: busy, title: '标记待重拍，保留旧产物供对照', onClick: () => changeShot(actIndex, index, { status: 'pending', notes: shot.notes.includes('待重拍') ? shot.notes : `${shot.notes}${shot.notes ? '\n' : ''}待重拍` }) }, '重拍'),
                h('button', { disabled: busy, onClick: () => changeShot(actIndex, index, { job_id: null, status: 'pending' }) }, '替换'),
                h('button', { disabled: busy, onClick: () => changeAct(actIndex, { shots: act.shots.filter((_, i) => i !== index) }) }, '移除'),
                h('button', { disabled: busy || index === 0, onClick: () => move(actIndex, index, -1), 'aria-label': '上移镜头' }, '↑'),
                h('button', { disabled: busy || index === act.shots.length - 1, onClick: () => move(actIndex, index, 1), 'aria-label': '下移镜头' }, '↓')))
          }),
          h('button', { disabled: busy, onClick: () => changeAct(actIndex, { shots: [...act.shots, { index: 0, role: '', action: '', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' }] }) }, '添加镜头')) : null)),
      h('button', { disabled: busy, onClick: () => save({ acts: [...project.acts, { title: `第 ${project.acts.length + 1} 幕`, shots: [] }] }) }, '添加幕'))
  }
  function deliveryUrl(item) {
    if (item.job_id) return assetUrl('download', item.job_id)
    try {
      const url = new URL(item.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
    } catch { /* Older project metadata may lack a server URL. */ }
    return null
  }
  function DeliveryView({ project }) {
    return h('div', null,
      !project.deliverables.length ? h('p', null, '暂无交付物') : null,
      project.deliverables.map((item, index) => {
        const url = deliveryUrl(item), specs = []
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        if (Number.isFinite(item.frame_count)) specs.push(`${item.frame_count}帧`)
        if (Number.isFinite(item.size_bytes)) specs.push(`${Number((item.size_bytes / 1024 / 1024).toFixed(2))}MB`)
        return h('article', { key: index, className: 'elysium-asset-item' },
          h('strong', null, `${['subtitle', 'srt', 'vtt'].includes(item.type) ? '📄' : '📦'} ${item.label}`),
          h('p', null, specs.length ? specs.join(' · ') : '规格未提供'),
          item.created_at ? h('small', null, relativeTime(item.created_at)) : null,
          url ? h('a', { href: url, download: '', target: '_blank', rel: 'noopener noreferrer' }, '下载') : h('p', { role: 'alert' }, '缺少可下载的服务器地址'))
      }))
  }
  function ProjectDetail({ id, back }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState('anchors'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const saving = useRef(false)
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id])
    async function run(action) {
      if (saving.current) return
      saving.current = true; setBusy(true); setError('')
      try { setProject(await action()) } catch (err) { setError(err.message) } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    return h('div', null, h('button', { disabled: busy, onClick: back }, '返回'),
      error ? h('p', { role: 'alert' }, error) : null,
      project ? h('div', null,
        h(Field, { value: project.title, label: '项目标题', disabled: busy, save: title => save({ title }) }),
        h('div', { role: 'tablist' }, [['anchors', '锚点'], ['acts', '分镜'], ['deliverables', '交付']].map(([value, label]) => h('button', { key: value, role: 'tab', 'aria-selected': tab === value, disabled: busy, onClick: () => setTab(value) }, label))),
        tab === 'anchors' ? h(AnchorView, { project, save, run, busy }) : tab === 'acts' ? h(StoryboardView, { project, save, busy }) : h(DeliveryView, { project })) : h('p', null, '加载中…'))
  }
  function ProjectList() {
    const [items, setItems] = useState([]), [selected, setSelected] = useState(null), [title, setTitle] = useState(''), [profile, setProfile] = useState('preview'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { if (!selected) refresh().catch(err => setError(err.message)) }, [selected])
    async function run(action) {
      setBusy(true); setError('')
      try { await action() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { key: selected, id: selected, back: () => setSelected(null) })
    return h('div', null,
      h('form', { onSubmit: event => { event.preventDefault(); run(async () => { const project = await createProject(title, profile); setTitle(''); setSelected(project.id) }) } },
        h('input', { 'aria-label': '新项目标题', placeholder: '新项目标题', value: title, onChange: event => setTitle(event.target.value), disabled: busy }),
        h('select', { 'aria-label': '项目档次', value: profile, disabled: busy, onChange: event => setProfile(event.target.value) }, Object.entries(profiles).map(([value, label]) => h('option', { key: value, value }, label))),
        h('button', { type: 'submit', disabled: busy || !title.trim() }, '+ 新建项目')),
      error ? h('p', { role: 'alert' }, error) : null,
      items.map(item => h('article', { className: 'elysium-asset-item', key: item.id },
        h('button', { onClick: () => setSelected(item.id), disabled: busy }, item.title),
        h('p', null, `${profiles[item.profile === 'hd' ? 'high-quality' : item.profile] || item.profile} · ${item.anchor_count} 锚点 · ${item.shot_count} 镜 · ${item.completed_count} 完成 · ${relativeTime(item.updated_at)}`),
        h('button', { disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }, '删除项目'))))
  }
  Object.assign(exports, { fetchProjects, fetchProject, createProject, updateProject, deleteProject, importMaterial, ProjectPicker, ProjectList, ProjectDetail, AnchorView, StoryboardView, DeliveryView, deliveryUrl })
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/asset-panel', factory: require => { const exports = {}
  const { createElement: h, useState, useEffect } = require('react')
  const { ProjectList } = require('elysium-tools/project')
  const { MaterialList } = require('elysium-tools/asset-list')
  const clamp = width => Math.max(180, Math.min(width, window.innerWidth / 2))
  function PanelToggle({ collapsed, onClick }) {
    return h('button', { className: 'elysium-panel-toggle', onClick, 'aria-expanded': !collapsed, 'aria-label': '切换素材与项目面板' }, collapsed ? '素材与项目面板' : '收起面板')
  }
  function AssetPanel({ toggleRoot }) {
    const [state, setState] = useState(() => {
      let saved = {}
      try { saved = JSON.parse(localStorage.getItem('elysium-panel-state')) || {} } catch { /* Use defaults when browser storage is unavailable. */ }
      return { collapsed: saved.collapsed !== false, width: clamp(Number.isFinite(saved.width) ? saved.width : Math.max(window.innerWidth * .1, 180)), activeTab: ['projects', 'storyboard'].includes(saved.activeTab) ? 'projects' : 'materials' }
    })
    const [dragging, setDragging] = useState(false)
    useEffect(() => {
      try { localStorage.setItem('elysium-panel-state', JSON.stringify(state)) } catch { /* The panel still works without persistence. */ }
      const previous = document.body.style.paddingRight
      if (!state.collapsed) document.body.style.paddingRight = `${state.width}px`
      return () => { document.body.style.paddingRight = previous }
    }, [state])
    useEffect(() => {
      const resize = () => setState(value => ({ ...value, width: clamp(value.width) }))
      window.addEventListener('resize', resize)
      return () => window.removeEventListener('resize', resize)
    }, [])
    useEffect(() => {
      if (!dragging) return
      const previous = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      const move = event => setState(value => ({ ...value, width: clamp(window.innerWidth - event.clientX) }))
      const stop = () => setDragging(false)
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', stop)
      return () => { document.body.style.userSelect = previous; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop) }
    }, [dragging])
    useEffect(() => { toggleRoot.render(h(PanelToggle, { collapsed: state.collapsed, onClick: () => setState(value => ({ ...value, collapsed: !value.collapsed })) })) }, [state.collapsed])
    if (state.collapsed) return null
    return h('aside', { className: 'elysium-panel', style: { width: state.width }, 'aria-label': '创作素材与项目面板' },
      h('div', { className: 'elysium-panel-resize', onMouseDown: event => { event.preventDefault(); setDragging(true) } }),
      h('div', { className: 'elysium-panel-header', role: 'tablist' },
        ['materials', 'projects'].map(tab => h('button', { key: tab, role: 'tab', 'aria-selected': state.activeTab === tab, className: state.activeTab === tab ? 'elysium-panel-tab elysium-panel-tab-active' : 'elysium-panel-tab', onClick: () => setState(value => ({ ...value, activeTab: tab })) }, tab === 'materials' ? '素材' : '项目'))),
      h('div', { className: 'elysium-panel-body' }, state.activeTab === 'materials' ? h(MaterialList) : h(ProjectList)))
  }
  function apply(ctx) {
    if (typeof document === 'undefined') return
    ctx.effect(() => {
      const { createRoot } = require('react-dom/client')
      const removeStyles = require('elysium-tools/panel-styles').apply()
      const panel = document.createElement('div'), toggle = document.createElement('div')
      document.body.append(panel, toggle)
      const root = createRoot(panel), toggleRoot = createRoot(toggle)
      root.render(h(AssetPanel, { toggleRoot }))
      return () => { root.unmount(); toggleRoot.unmount(); panel.remove(); toggle.remove(); removeStyles() }
    })
  }
  Object.assign(exports, { AssetPanel, PanelToggle, apply })
return exports
} })

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-elysium-tools', factory: require => ({
    inject: ['slots', 'uiConversation', 'inputTriggers'],
    apply(ctx) {
      require('elysium-tools/media-card').apply(ctx)
      require('elysium-tools/media-results').apply(ctx)
      require('elysium-tools/creation-commands').apply(ctx)
      require('elysium-tools/asset-panel').apply(ctx)
    },
  }),
})
