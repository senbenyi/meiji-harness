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
.elysium-panel button, .elysium-panel-toggle { border: 1px solid #8885; border-radius: 6px; padding: 5px 8px; background: var(--dsw-alias-background-primary, #303030); color: inherit; cursor: pointer; }
.elysium-panel button:disabled { opacity: .5; cursor: wait; }
.elysium-asset-item { padding: 10px 0; border-bottom: 1px solid #8884; overflow-wrap: anywhere; }
.elysium-panel a { color: #8bcaff; }
.elysium-panel input, .elysium-panel textarea { box-sizing: border-box; width: 100%; margin: 4px 0; background: transparent; color: inherit; border: 1px solid #8887; padding: 5px; }
.elysium-panel-actions { display: flex; gap: 4px; flex-wrap: wrap; }

.elysium-panel { inset:0; width:100%; z-index:1000; font:14px/1.5 system-ui; }
.elysium-panel-header { flex:none; align-items:center; height:56px; box-sizing:border-box; padding:10px 24px; }
.elysium-panel-header strong { margin-right:24px; }
.elysium-return { margin-left:auto; }
.elysium-panel-body { min-height:0; padding:16px 24px; display:flex; flex-direction:column; overflow:hidden; }
.elysium-dialog-backdrop { position:fixed; inset:0; z-index:1100; background:#0009; display:grid; place-items:center; padding:16px; }
.elysium-dialog { background:var(--dsw-alias-background-primary,#202020); border:1px solid #8886; border-radius:12px; width:min(960px,100%); max-height:90dvh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 16px 64px #0006; }
.elysium-dialog header,.elysium-dialog footer { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px; }
.elysium-dialog h2 { margin:0; font-size:18px; }
.elysium-dialog-body { overflow:auto; min-height:0; padding:16px; }
.elysium-panel button,.elysium-panel input,.elysium-panel select { min-height:36px; }
.elysium-panel :focus-visible { outline:2px solid #8bcaff; outline-offset:2px; }
.elysium-panel [aria-selected=true] { background:#73adcf22; color:#8bcaff; }

.elysium-panel-body:has(.elysium-storyboard) { overflow:hidden; display:flex; flex-direction:column; }
.elysium-project-detail,.elysium-project-content { min-height:0; display:flex; flex-direction:column; flex:1; gap:8px; }
.elysium-project-detail > button { align-self:flex-start; }
.elysium-project-content > [role=tablist] { display:flex; gap:8px; flex:none; }
.elysium-storyboard { min-height:0; flex:1; display:grid; grid-template-columns:176px minmax(0,1fr) 360px; gap:16px; }
.elysium-acts { overflow:auto; display:flex; flex-direction:column; gap:8px; }
.elysium-acts button { text-align:left; }
.elysium-shot-list { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
.elysium-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:8px 0; flex:none; }
.elysium-toolbar input { width:180px; }
.elysium-toolbar label { font-size:12px; }
.elysium-toolbar select { display:block; max-width:140px; }
.elysium-shot-rows { overflow:auto; min-height:0; flex:1; }
.elysium-panel .elysium-shot-row { display:grid; grid-template-columns:32px 24px 64px minmax(0,1fr) 52px; gap:8px; align-items:center; text-align:left; width:100%; height:56px; border:0; border-bottom:1px solid #8883; border-radius:0; }
.elysium-shot-summary { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.elysium-panel [aria-pressed=true] { background:#73adcf22; box-shadow:inset 3px 0 #8bcaff; }
.elysium-shot-detail { min-height:0; overflow:auto; border-left:1px solid #8883; padding:0 16px; overflow-wrap:anywhere; }
.elysium-shot-detail h2 { font-size:18px; }
.elysium-shot-detail p { white-space:pre-wrap; }
.elysium-panel .elysium-workbench-preview { display:block; width:100%; max-height:420px; object-fit:contain; background:#111; margin:12px 0; }
.elysium-pagination { display:flex; gap:8px; align-items:center; padding:12px 0; flex-wrap:wrap; flex:none; }
.elysium-empty { text-align:center; padding:40px 16px; color:#999; }
.elysium-field { display:block; margin-bottom:16px; }
.elysium-field span { display:block; margin-bottom:4px; }
.elysium-field select { width:100%; }
.elysium-panel .elysium-primary { background:#8bcaff; color:#14232d; border-color:transparent; }
@media(max-width:1279px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr) 320px; } .elysium-acts { display:none; } }
@media(max-width:959px) { .elysium-storyboard { grid-template-columns:minmax(0,1fr); } .elysium-shot-detail { display:none; } .elysium-storyboard.has-selection .elysium-shot-list { display:none; } .elysium-storyboard.has-selection .elysium-shot-detail { display:block; } }
@media(max-width:600px) { .elysium-panel-header { padding:8px; gap:4px; } .elysium-panel-header strong { margin-right:4px; } .elysium-panel-body { padding:8px; } .elysium-panel button { min-height:44px; } .elysium-toolbar input { width:100%; } .elysium-shot-row { font-size:12px; } }

.elysium-materials { display:flex; flex-direction:column; min-height:0; height:100%; }
.elysium-material-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:16px; overflow:auto; align-content:start; min-height:0; flex:1; }
.elysium-material-card { border:1px solid #8883; border-radius:10px; padding:12px; min-width:0; display:flex; flex-direction:column; gap:8px; }
.elysium-material-card > img,.elysium-card-open img { width:100%; height:180px; object-fit:contain; background:#111; border-radius:6px; }
.elysium-panel .elysium-card-open { padding:0; border:0; text-align:left; }
.elysium-card-open strong,.elysium-two-lines { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.elysium-card-open strong { height:42px; margin-top:8px; }
.elysium-video-placeholder { height:180px; background:#8881; border-radius:6px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#aaa; font-size:24px; }
.elysium-video-placeholder small { font-size:12px; }
.elysium-material-card > small { color:#aaa; }
.elysium-dialog-body .elysium-materials { height:min(600px,65dvh); }
.elysium-anchor-view { min-height:0; flex:1; display:flex; flex-direction:column; overflow:hidden; }
.elysium-project-home { overflow:auto; min-height:0; }
@media(max-width:600px) { .elysium-material-grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; } }

.elysium-project-heading { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.elysium-panel h1 { font-size:20px; margin:8px 0; }
.elysium-panel h2 { font-size:18px; margin:8px 0; }
.elysium-project-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }
.elysium-delivery { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:24px; overflow:auto; }
.elysium-panel .elysium-delivery-preview .elysium-workbench-preview { max-height:65dvh; }
.elysium-asset-item a { display:inline-block; margin:8px; }
.elysium-panel details { margin-top:8px; }
.elysium-panel summary { cursor:pointer; min-height:36px; }
.elysium-panel details button { margin:4px; }
@media(max-width:959px) { .elysium-delivery { grid-template-columns:minmax(0,1fr); } }
@media(prefers-reduced-motion:reduce) { .elysium-panel * { animation:none !important; transition:none !important; } }

.elysium-panel { color-scheme:inherit; scrollbar-color:#666 transparent; }
.elysium-panel select { border:1px solid #8885; border-radius:6px; background:var(--dsw-alias-background-primary,#292929); color:inherit; padding:4px; }
.elysium-mobile-act { display:none; }
@media(max-width:1279px) { .elysium-mobile-act { display:inline-block; } }
`
    document.head.appendChild(style)
    return () => style.remove()
  }
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/dialog', factory: require => { const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  function trapFocus(event, root) {
    if (event.key !== 'Tab' || !root) return
    const nodes = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"],summary')].filter(node => node.getClientRects().length)
    const first = nodes[0], last = nodes[nodes.length - 1]
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus() }
  }
  function Dialog({ title, close, busy, children, footer }) {
    const root = useRef(null), previous = useRef(null)
    useEffect(() => {
      previous.current = document.activeElement
      root.current?.focus()
      return () => previous.current?.focus?.()
    }, [])
    function keyDown(event) {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) close() }
      if (event.key === 'Tab') { event.stopPropagation(); trapFocus(event, root.current) }
    }
    return h('div', { className: 'elysium-dialog-backdrop', onKeyDown: keyDown },
      h('section', { className: 'elysium-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': title, tabIndex: -1, ref: root },
        h('header', null, h('h2', null, title), h('button', { disabled: busy, onClick: close, 'aria-label': '关闭对话框' }, '关闭')),
        h('div', { className: 'elysium-dialog-body' }, children),
        h('footer', null, footer, h('button', { disabled: busy, onClick: close }, '取消'))))
  }
  function Editor({ title, initial, fields, save, close, guard }) {
    const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(null)
    const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
    const leave = action => dirty ? setPending(() => action) : action()
    useEffect(() => { if (guard) guard.current = leave; return () => { if (guard) guard.current = null } }, [dirty])
    useEffect(() => { if (!dirty) return; const warn = event => { event.preventDefault(); event.returnValue = '' }; window.addEventListener?.('beforeunload', warn); return () => window.removeEventListener?.('beforeunload', warn) }, [dirty])
    async function submit(action = close) {
      if (busy) return
      setBusy(true); setError('')
      try { if (await save(draft) === false) throw new Error('保存失败，请重试'); action() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    function renderField([key, label, type]) {
      const props = { 'aria-label': label, value: draft[key] || '', disabled: busy, onChange: e => setDraft({ ...draft, [key]: e.target.value }) }
      return h('label', { className: 'elysium-field', key }, h('span', null, label), Array.isArray(type)
        ? h('select', props, h('option', { value: '' }, '请选择'), type.map(([value, text]) => h('option', { key: value, value }, text)))
        : h(type === 'textarea' ? 'textarea' : 'input', { ...props, rows: 3 }))
    }
    return h(Dialog, { title, busy, close: () => leave(close), footer: h('button', { className: 'elysium-primary', disabled: busy, onClick: () => submit() }, busy ? '保存中…' : '保存') },
      fields.filter(field => !field[3]).map(renderField),
      fields.some(field => field[3]) ? h('details', null, h('summary', null, '技术详情'), fields.filter(field => field[3]).map(renderField)) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      pending ? h(Dialog, { title: '有未保存的修改', busy, close: () => setPending(null), footer: h('button', { disabled: busy, onClick: () => submit(() => { close(); pending() }) }, '保存并继续') },
        h('button', { disabled: busy, onClick: () => { close(); pending() } }, '放弃修改'), h('button', { onClick: () => setPending(null) }, '继续编辑')) : null)
  }
  Object.assign(exports, { Dialog, Editor, trapFocus })
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/asset-list', factory: require => { const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { mediaUrl } = require('elysium-tools/media-api')
  const { specificationLabel } = require('elysium-tools/media-model')
  const { Dialog } = require('elysium-tools/dialog')
  const assetUrl = (kind, job) => mediaUrl(kind, null, null, { job })
  async function fetchAssets(offset = 0, limit = 30, filters = {}, signal) {
    const response = await fetch(mediaUrl('list', null, null, { offset, limit, ...filters }), { cache: 'no-store', credentials: 'same-origin', signal })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '素材读取失败')
    return value
  }
  function relativeTime(time) {
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
    return !Number.isFinite(minutes) ? '时间未记录' : minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`
  }
  const listCache = new Map()
  const assetTitle = item => item.title || item.prompt_excerpt || `${item.has_video ? '视频' : '图片'} · ${item.job_id.slice(0, 8)}`
  function MaterialList({ onSelect, viewState = {}, onViewState = () => {} } = {}) {
    const [state, setState] = useState({ profile: '', media_kind: '', q: '', page: 0, ...viewState })
    const [input, setInput] = useState(state.q), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0)
    const [preview, setPreview] = useState(null), [importJob, setImportJob] = useState(null), [submitting, setSubmitting] = useState(false), [mediaError, setMediaError] = useState(false)
    const sequence = useRef(0), grid = useRef(null)
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (input === state.q) return; const timer = setTimeout(() => change({ q: input, page: 0 }), 250); return () => clearTimeout(timer) }, [input, state.q])
    useEffect(() => {
      const controller = new AbortController(), request = ++sequence.current
      const key = mediaUrl('list', null, null, { ...state, scroll: 0 })
      const cached = listCache.get(key)
      if (cached && Date.now() - cached.time < 30000) { setData(cached.value); setBusy(false); setError(''); return () => { ++sequence.current; controller.abort() } }
      setBusy(true); setError(''); setData(cached?.value || null)
      fetchAssets(state.page * 30, 30, { profile: state.profile, media_kind: state.media_kind, q: state.q }, controller.signal).then(value => {
        if (request === sequence.current) { listCache.set(key, { value, time: Date.now() }); if (listCache.size > 8) listCache.delete(listCache.keys().next().value); setData(value); if (grid.current) grid.current.scrollTop = state.scroll || 0 }
      }).catch(err => { if (!controller.signal.aborted && request === sequence.current) setError(err.message) }).finally(() => { if (request === sequence.current) setBusy(false) })
      return () => { ++sequence.current; controller.abort() }
    }, [state.profile, state.media_kind, state.q, state.page, retry])
    useEffect(() => { if (grid.current && data) grid.current.scrollTop = state.scroll || 0 }, [data])
    const select = (label, key, options) => h('label', null, label, h('select', { 'aria-label': label, value: state[key], onChange: event => change({ [key]: event.target.value, page: 0, scroll: 0 }) }, options.map(([value, text]) => h('option', { key: value, value }, text))))
    async function choose() {
      if (submitting) return
      setSubmitting(true); setError('')
      try { if (await onSelect(preview) === false) throw new Error('素材写入失败，请重试'); setPreview(null) } catch (err) { setError(err.message) } finally { setSubmitting(false) }
    }
    return h('div', { className: 'elysium-materials' },
      h('div', { className: 'elysium-toolbar' }, h('input', { type: 'search', 'aria-label': '搜索素材', placeholder: '搜索描述或任务 ID', value: input, onChange: e => setInput(e.target.value) }),
        select('档次', 'profile', [['', '全部档次'], ['preview', '预览'], ['regular', '常规'], ['high-quality', '高清']]),
        select('类型', 'media_kind', [['', '全部类型'], ['video', '视频'], ['image', '图片']]),
        h('span', { role: 'status' }, busy ? '正在读取…' : `共 ${data?.total ?? data?.items.length ?? 0} 项`),
        h('button', { onClick: () => { setInput(''); change({ profile: '', media_kind: '', q: '', page: 0, scroll: 0 }) } }, '清空筛选'), h('button', { disabled: busy, onClick: () => { listCache.clear(); setRetry(x => x + 1) } }, '刷新素材')),
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => { listCache.clear(); setRetry(x => x + 1) } }, '重试')) : null,
      busy ? h('div', { className: 'elysium-empty', role: 'status' }, '正在加载素材…') : null,
      data?.items.length === 0 ? h('p', { className: 'elysium-empty' }, state.q || state.profile || state.media_kind ? '无匹配素材，请调整筛选条件' : '暂无已完成素材') : null,
      h('div', { className: 'elysium-material-grid', ref: grid, onScroll: e => onViewState({ ...state, scroll: e.currentTarget.scrollTop }) },
        data?.items.map(item => h('article', { key: item.job_id, className: 'elysium-material-card' },
          h('button', { className: 'elysium-card-open', onClick: () => { setPreview(item); setMediaError(false) }, 'aria-label': `查看素材 ${assetTitle(item)}` },
            item.has_image ? h('img', { src: assetUrl('image', item.job_id), alt: assetTitle(item), loading: 'lazy' }) : h('div', { className: 'elysium-video-placeholder' }, '▶', h('small', null, '点击预览视频')),
            h('strong', null, assetTitle(item))), h('small', null, specificationLabel(item) || (item.has_image ? '图片' : '视频')), h('small', null, relativeTime(item.created_at))))),
      h('footer', { className: 'elysium-pagination' }, h('span', null, `第 ${state.page + 1}/${Math.max(1, Math.ceil((data?.total || 0) / 30))} 页`), h('button', { disabled: busy || state.page === 0, onClick: () => change({ page: state.page - 1, scroll: 0 }) }, '上一页'), h('button', { disabled: busy || !data?.has_more, onClick: () => change({ page: state.page + 1, scroll: 0 }) }, '下一页')),
      preview && !importJob ? h(Dialog, { title: assetTitle(preview), close: () => setPreview(null), busy: submitting, footer: onSelect ? h('button', { disabled: submitting, className: 'elysium-primary', onClick: choose }, submitting ? '正在使用…' : '使用此素材') : h('button', { onClick: () => setImportJob(preview.job_id) }, '用作项目锚点') },
        mediaError ? h('p', { role: 'alert' }, '预览加载失败', h('button', { onClick: () => setMediaError(false) }, '重试预览')) : h(preview.has_video ? 'video' : 'img', { className: 'elysium-workbench-preview', src: assetUrl(preview.has_video ? 'video' : 'image', preview.job_id), ...(preview.has_video ? { controls: true, preload: 'metadata' } : { alt: assetTitle(preview) }), onError: () => setMediaError(true) }),
        h('p', null, preview.prompt_excerpt || '未记录描述'), error ? h('p', { role: 'alert' }, error) : null,
        h('a', { href: assetUrl('download', preview.job_id), download: '' }, '下载')) : null,
      importJob ? h(require('elysium-tools/project').ProjectPicker, { jobId: importJob, close: () => setImportJob(null) }) : null)
  }
  Object.assign(exports, { MaterialList, fetchAssets, assetUrl, relativeTime, assetTitle })
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/project', factory: require => { const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { projectUrl } = require('elysium-tools/media-api')
  const { assetUrl, relativeTime, MaterialList } = require('elysium-tools/asset-list')
  const { Dialog, Editor } = require('elysium-tools/dialog')
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
  const previews = new Map()
  function ShotPreview({ jobId }) {
    const [job, setJob] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
    useEffect(() => {
      let active = true
      setJob(null); setError('')
      if (!jobId) return
      const key = assetUrl('status', jobId)
      if (retry) previews.delete(key)
      if (!previews.has(key)) {
        const entry = { controller: new AbortController(), users: 0, settled: false }
        entry.promise = fetch(key, { cache: 'no-store', credentials: 'same-origin', signal: entry.controller.signal }).then(async response => {
          const value = await response.json(); if (!response.ok) throw new Error(value.error || '预览读取失败'); entry.settled = true; return value
        }).catch(error => { if (previews.get(key) === entry) previews.delete(key); throw error })
        previews.set(key, entry)
        if (previews.size > 30) previews.delete(previews.keys().next().value)
      }
      const entry = previews.get(key)
      entry.users++
      entry.promise.then(value => { if (active) setJob(value); if (value.status && value.status !== 'succeeded' && previews.get(key) === entry) previews.delete(key) }).catch(err => { if (active && err.name !== 'AbortError') setError(err.message) })
      return () => { active = false; entry.users--; if (!entry.users && !entry.settled) { entry.controller.abort(); if (previews.get(key) === entry) previews.delete(key) } }
    }, [jobId, retry])
    if (!jobId) return h('p', { className: 'elysium-empty' }, '尚未关联素材')
    if (error) return h('div', { role: 'alert' }, error, h('button', { onClick: () => setRetry(value => value + 1) }, '重试预览'))
    if (!job) return h('p', { role: 'status' }, '正在加载预览…')
    return job.has_video ? h('video', { className: 'elysium-workbench-preview', src: assetUrl('video', jobId), preload: 'metadata', controls: true, onError: () => setError('预览加载失败') }) : job.has_image ? h('img', { className: 'elysium-workbench-preview', src: assetUrl('image', jobId), alt: '镜头图片', onError: () => setError('图片加载失败') }) : h('div', null, h('p', null, '暂无可播放产物'), h('button', { onClick: () => setRetry(value => value + 1) }, '刷新状态'))
  }
  function ProjectPicker({ jobId, close }) {
    const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState(null), [loading, setLoading] = useState(true)
    useEffect(() => { let active = true; fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
    async function choose() {
      if (busy || !selected) return
      setBusy(true); setError('')
      try { await importMaterial(selected, jobId); close() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    return h(Dialog, { title: '选择项目', close, busy, footer: h('button', { className: 'elysium-primary', disabled: busy || !selected, onClick: choose }, busy ? '正在使用…' : '用作项目锚点') },
      h('p', null, '选择目标项目，确认后新增一个锚点'),
      items.map(item => h('button', { key: item.id, disabled: busy, 'aria-pressed': selected === item.id, onClick: () => setSelected(item.id) }, item.title)),
      loading ? h('p', { role: 'status' }, '正在读取项目…') : !items.length ? h('p', null, '请先在项目页新建项目') : null,
      error ? h('p', { role: 'alert' }, error) : null)
  }
  function AnchorView({ project, save, run, busy, guard }) {
    const [selecting, setSelecting] = useState(null), [editing, setEditing] = useState(null), [inspecting, setInspecting] = useState(null)
    return h('div', { className: 'elysium-anchor-view' },
      h('div', { className: 'elysium-toolbar' }, h('h2', null, '锚点'), h('button', { className: 'elysium-primary', disabled: busy, onClick: () => {
        let number = project.anchors.length + 1
        while (project.anchors.some(anchor => anchor.role === `role-${number}`)) number++
        setEditing({ index: -1, role: `role-${number}`, label: '新锚点', description: '', image_url: '', source: null })
      } }, '添加锚点')),
      h('div', { className: 'elysium-material-grid' }, project.anchors.map((anchor, index) => h('article', { key: anchor.role, className: 'elysium-material-card' },
        anchor.image_url ? h('img', { src: anchor.image_url, alt: anchor.label, loading: 'lazy' }) : h('div', { className: 'elysium-video-placeholder' }, anchor.source?.job_id ? '视频参考素材' : '暂无参考图'),
        h('button', { onClick: () => setInspecting(anchor) }, '查看参考素材'), h('h3', null, anchor.label || anchor.role), h('p', { className: 'elysium-two-lines' }, anchor.description || '未填写描述'),
        h('button', { disabled: busy, onClick: () => setEditing({ ...anchor, index }) }, '编辑锚点'),
        h('button', { disabled: busy, onClick: () => setSelecting(anchor) }, '选择参考素材')))),
      inspecting ? h(Dialog, { title: inspecting.label || inspecting.role, close: () => setInspecting(null) }, inspecting.image_url ? h('img', { className: 'elysium-workbench-preview', src: inspecting.image_url, alt: inspecting.label }) : h(ShotPreview, { jobId: inspecting.source?.job_id }), h('p', null, inspecting.description)) : null,
      selecting ? h(Dialog, { title: `为「${selecting.label || selecting.role}」选择参考素材`, close: () => setSelecting(null), busy },
        h(MaterialList, { viewState: { media_kind: 'image' }, onSelect: item => run(async () => { const value = await importMaterial(project.id, item.job_id, 'anchor', selecting.role); setSelecting(null); return value }) })) : null,
      editing ? h(Editor, { title: '编辑锚点', initial: editing, guard, fields: [['label', '锚点名称'], ['description', '锚点描述', 'textarea'], ['role', '锚点角色 ID', null, true], ['image_url', '参考图服务器 URL', null, true]], close: () => setEditing(null), save: draft => {
        const { index, ...anchor } = draft
        if (anchor.image_url !== editing.image_url) anchor.source = null
        return save({ anchors: index === -1 ? [...project.anchors, anchor] : project.anchors.map((item, i) => i === index ? anchor : item),
          ...(index >= 0 && editing.role !== anchor.role ? { acts: project.acts.map(act => ({ ...act, shots: act.shots.map(shot => shot.role === editing.role ? { ...shot, role: anchor.role } : shot) })) } : {}) })
      } }) : null)
  }
  const { StoryboardView } = require('elysium-tools/storyboard-view')
  function deliveryUrl(item) {
    if (item.job_id) return assetUrl('download', item.job_id)
    try {
      const url = new URL(item.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
    } catch { /* Older project metadata may lack a server URL. */ }
    return null
  }
  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '大小未记录'
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(2))}KB`
    return `${Number((bytes / 1024 / 1024).toFixed(2))}MB`
  }
  function DeliveryView({ project }) {
    const isSubtitle = item => ['subtitle', 'srt', 'vtt'].includes(item.type)
    const [selected, setSelected] = useState(null), [error, setError] = useState(false)
    const item = project.deliverables[selected], url = item && deliveryUrl(item)
    return h('div', { className: 'elysium-delivery' },
      h('section', { className: 'elysium-delivery-preview' },
        !project.deliverables.length ? h('p', { className: 'elysium-empty' }, `尚无交付物 · ${project.acts.flatMap(act => act.shots).filter(shot => shot.status === 'succeeded').length} 镜已完成`) : !item ? h('p', { className: 'elysium-empty' }, '选择成片，开始审看') : null,
        item ? h('div', null, h('h2', null, item.label), error ? h('p', { role: 'alert' }, '成片预览加载失败', h('button', { onClick: () => setError(false) }, '重试预览')) : url ? h('video', { key: url, className: 'elysium-workbench-preview', src: item.job_id ? assetUrl('video', item.job_id) : url, controls: true, preload: 'metadata', onError: () => setError(true) }) : h('p', { role: 'alert' }, '缺少可播放的服务器地址')) : null),
      h('section', null, h('h2', null, '交付文件'), project.deliverables.map((item, index) => {
        const url = deliveryUrl(item), specs = []
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        if (Number.isFinite(item.frame_count)) specs.push(`${item.frame_count}帧`)
        if (Number.isFinite(item.size_bytes)) specs.push(formatSize(item.size_bytes))
        return h('article', { key: index, className: 'elysium-asset-item' },
          h('strong', null, `${isSubtitle(item) ? '字幕' : '成片'} · ${item.label}`), h('p', null, specs.join(' · ') || '规格未提供'),
          item.created_at ? h('small', null, relativeTime(item.created_at)) : null,
          !isSubtitle(item) && url ? h('button', { onClick: () => { setSelected(index); setError(false) } }, '审看成片') : null,
          url ? h('a', { href: url, download: '', target: '_blank', rel: 'noopener noreferrer' }, '下载') : h('p', { role: 'alert' }, '缺少可下载的服务器地址'))
      })))
  }
  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard, navigate = action => action() }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState(viewState.projects?.[id]?.tab || viewState.projectTab || null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false)
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
    async function run(action) {
      if (saving.current) return false
      saving.current = true; setBusy(true); setError(''); setSaved(false)
      try { setProject(await action()); setSaved(true); return true } catch (err) { setError(err.message); return false } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    const activeTab = tab || (project?.acts.some(act => act.shots.length) ? 'acts' : 'anchors')
    return h('div', { className: 'elysium-project-detail' },
      h('div', { className: 'elysium-project-heading' }, h('button', { disabled: busy, onClick: () => navigate(back) }, '返回项目'),
        h('h1', null, project?.title || '项目'), project ? h('button', { disabled: busy, onClick: () => setEditing(true) }, '修改标题') : null,
        h('span', { role: 'status' }, busy ? '保存中…' : saved ? '已保存' : '')),
      error ? h('p', { role: 'alert' }, error, !project ? h('button', { onClick: () => { setError(''); setReload(x => x + 1) } }, '重试') : null) : null,
      project ? h('div', { className: 'elysium-project-content' },
        h('div', { role: 'tablist', 'aria-label': '项目页面' }, [['anchors', '锚点'], ['acts', '分镜'], ['deliverables', '交付']].map(([value, label]) => h('button', { key: value, role: 'tab', 'aria-selected': activeTab === value, disabled: busy, onClick: () => navigate(() => { setTab(value); onViewState({ projectTab: value, projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], tab: value } } }) }) }, label))),
        activeTab === 'anchors' ? h(AnchorView, { project, save, run, busy, guard }) : activeTab === 'acts' ? h(StoryboardView, { project, save, busy, guard, viewState: viewState.projects?.[id], onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) }) : h(DeliveryView, { project })) : h('p', { role: 'status' }, '加载中…'),
      editing ? h(Editor, { title: '修改项目标题', initial: { title: project.title }, fields: [['title', '项目标题']], guard, close: () => setEditing(false), save }) : null)
  }
  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action() } = {}) {
    const [items, setItems] = useState([]), [selected, setSelectedLocal] = useState(viewState.selected || null), [creating, setCreating] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('')
    const setSelected = selected => { setSelectedLocal(selected); onViewState({ selected, ...(selected !== viewState.selected ? { projectTab: null } : {}) }) }
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { let active = true; if (!selected) { setBusy(true); fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }) } return () => { active = false } }, [selected])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { key: selected, id: selected, viewState, onViewState, guard, navigate, back: () => setSelected(null) })
    return h('div', { className: 'elysium-project-home' },
      h('div', { className: 'elysium-toolbar' }, h('h1', null, '项目'), h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索项目', value: query, onChange: e => setQuery(e.target.value) }), h('button', { className: 'elysium-primary', onClick: () => setCreating(true) }, '新建项目')),
      busy ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !items.length && !error ? h('p', { className: 'elysium-empty' }, '还没有项目，从新建项目开始') : null,
      h('div', { className: 'elysium-project-grid' }, items.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).map(item => h('article', { className: 'elysium-material-card', key: item.id },
        item.cover_url ? h('img', { src: item.cover_url, loading: 'lazy', alt: item.title }) : h('div', { className: 'elysium-video-placeholder' }, item.title.slice(0, 1)),
        h('h2', null, item.title), h('p', null, `${profiles[item.profile === 'hd' ? 'high-quality' : item.profile] || item.profile} · ${item.anchor_count} 锚点`),
        h('p', null, `${item.completed_count}/${item.shot_count} 镜完成 · ${relativeTime(item.updated_at)}`),
        h('button', { className: 'elysium-primary', onClick: () => setSelected(item.id), disabled: busy, 'aria-label': `继续制作 ${item.title}` }, '继续制作'),
        h('details', null, h('summary', null, '更多操作'), h('button', { disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }, '删除项目'))))),
      creating ? h(Editor, { title: '新建项目', initial: { title: '', profile: 'preview' }, fields: [['title', '新项目标题'], ['profile', '项目档次', Object.entries(profiles)]], guard, close: () => setCreating(false), save: async draft => {
        const success = await run(async () => { const project = await createProject(draft.title, draft.profile); setSelected(project.id) }); return success
      } }) : null)
  }
  Object.assign(exports, { fetchProjects, fetchProject, createProject, updateProject, deleteProject, importMaterial, ProjectPicker, ProjectList, ProjectDetail, AnchorView, StoryboardView, DeliveryView, deliveryUrl, formatSize, ShotPreview })
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/storyboard-view', factory: require => { const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { Editor } = require('elysium-tools/dialog')
  const statuses = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败' }
  function StoryboardView({ project, save, busy, viewState = {}, onViewState = () => {}, guard }) {
    const [state, setState] = useState({ act: '', q: '', status: '', role: '', page: 0, selected: null, ...viewState })
    const [editing, setEditing] = useState(null), scroll = useRef(null), keyboard = useRef(false)
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (scroll.current) scroll.current.scrollTop = state.scroll || 0 }, [])
    const all = project.acts.flatMap((act, a) => act.shots.map((shot, i) => ({ shot, a, i, key: `${a}:${i}` }))).map((item, index) => ({ ...item, number: index + 1 }))
    const matches = item => (!state.q || [String(item.number), String(item.number).padStart(3, '0'), item.shot.action, item.shot.subtitle].some(text => text?.toLowerCase().includes(state.q.toLowerCase()))) && (!state.status || item.shot.status === state.status) && (!state.role || item.shot.role === state.role)
    const filtered = all.filter(item => (state.act === '' || String(item.a) === state.act) && matches(item))
    const pages = Math.max(1, Math.ceil(filtered.length / 30)), page = Math.min(state.page, pages - 1)
    const selected = all.find(item => item.key === state.selected && (state.selectedJob === undefined || item.shot.job_id === state.selectedJob)), position = filtered.findIndex(item => item.key === state.selected)
    useEffect(() => { if (keyboard.current && selected) { keyboard.current = false; scroll.current?.querySelector(`[aria-label="镜 ${String(selected.number).padStart(3, '0')}"]`)?.focus() } }, [state.selected, state.page])
    const choose = item => change({ selected: item.key, selectedJob: item.shot.job_id, page: Math.floor(filtered.indexOf(item) / 30) })
    const filter = patch => change({ ...patch, page: 0, selected: null, scroll: 0 })
    const actIndex = state.act === '' ? selected?.a ?? 0 : Number(state.act)
    const commitActs = async acts => save({ acts })
    const patchShot = async patch => { const ok = await commitActs(project.acts.map((act, a) => a === selected.a ? { ...act, shots: act.shots.map((shot, i) => i === selected.i ? { ...shot, ...patch } : shot) } : act)); if (ok && 'job_id' in patch) change({ selectedJob: patch.job_id }); return ok }
    async function move(direction) {
      const acts = project.acts.map((act, a) => ({ ...act, shots: [...act.shots] }))
      const shots = acts[selected.a].shots, target = selected.i + direction
      ;[shots[selected.i], shots[target]] = [shots[target], shots[selected.i]]
      if (await commitActs(acts)) change({ selected: `${selected.a}:${target}`, selectedJob: shots[target].job_id })
    }
    async function remove() {
      if (!window.confirm(`移除镜 ${String(selected.number).padStart(3, '0')}？`)) return
      const acts = project.acts.map((act, a) => a === selected.a ? { ...act, shots: act.shots.filter((_, i) => i !== selected.i) } : act)
      if (await commitActs(acts)) change({ selected: null, selectedJob: undefined })
    }
    const select = (label, key, options) => h('label', null, label, h('select', { 'aria-label': label, value: state[key], onChange: e => filter({ [key]: e.target.value }) }, options.map(([value, label]) => h('option', { key: value, value }, label))))
    const { ShotPreview } = require('elysium-tools/project')
    const anchor = selected && project.anchors.find(item => item.role === selected.shot.role)
    const currentAct = project.acts[actIndex]
    const shotFields = [
      ['role', '镜头角色', project.anchors.map(anchor => [anchor.role, anchor.label || anchor.role])], ['action', '动作描述', 'textarea'], ['subtitle', '字幕', 'textarea'], ['notes', '镜头备注', 'textarea'],
      ['mode', '生成模式', null, true], ['job_id', '关联任务 ID', null, true], ['status', '镜头状态', Object.entries(statuses)],
    ]
    return h('div', { className: `elysium-storyboard${selected ? ' has-selection' : ''}` },
      h('nav', { className: 'elysium-acts', 'aria-label': '幕导航' }, h('h3', null, '幕'),
        h('button', { 'aria-pressed': state.act === '', onClick: () => filter({ act: '' }) }, `全部 ${all.length}`),
        project.acts.map((act, a) => h('button', { key: a, 'aria-pressed': state.act === String(a), onClick: () => filter({ act: String(a) }) }, `${a + 1}. ${act.title} · ${act.shots.filter(s => s.status === 'succeeded').length}/${act.shots.length}`)),
        h('button', { disabled: busy, onClick: () => setEditing({ kind: 'new-act', title: `第 ${project.acts.length + 1} 幕` }) }, '添加幕')),
      h('div', { className: 'elysium-shot-list' },
        h('div', { className: 'elysium-toolbar' },
          h('input', { 'aria-label': '搜索镜头', placeholder: '镜号、动作或字幕', value: state.q, onChange: e => filter({ q: e.target.value }) }),
          select('幕', 'act', [['', '全部幕'], ...project.acts.map((act, a) => [String(a), act.title])]),
          select('状态', 'status', [['', '全部状态'], ...Object.entries(statuses)]), select('角色', 'role', [['', '全部角色'], ...project.anchors.map(a => [a.role, a.label || a.role])]),
          h('button', { className: 'elysium-mobile-act', disabled: busy, onClick: () => setEditing({ kind: 'new-act', title: `第 ${project.acts.length + 1} 幕` }) }, '添加幕'), h('span', null, `${filtered.length} 镜`), h('button', { onClick: () => filter({ q: '', act: '', status: '', role: '' }) }, '清空筛选')),
        h('div', { className: 'elysium-shot-rows', ref: scroll, tabIndex: 0, role: 'region', 'aria-label': '镜头列表', onScroll: e => { onViewState({ ...state, scroll: e.currentTarget.scrollTop }) } },
          !filtered.length ? h('p', null, '无匹配镜头', state.q && state.act !== '' ? h('button', { onClick: () => filter({ act: '', role: '', status: '' }) }, '在全部镜头中定位') : null) : null,
          filtered.slice(page * 30, page * 30 + 30).map(item => {
            const anchor = project.anchors.find(a => a.role === item.shot.role)
            return h('button', { key: item.key, className: 'elysium-shot-row', 'aria-label': `镜 ${String(item.number).padStart(3, '0')}`, 'aria-pressed': item.key === state.selected, onClick: () => choose(item), onKeyDown: e => {
              if (['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); keyboard.current = true; const next = filtered[Math.max(0, Math.min(filtered.length - 1, filtered.indexOf(item) + (e.key === 'ArrowDown' ? 1 : -1)))]; choose(next) }
            } }, h('b', null, String(item.number).padStart(3, '0')), h('span', { className: 'elysium-shot-icon' }, item.shot.job_id ? '▶' : '—'), h('span', null, anchor?.label || item.shot.role || '无角色'), h('span', { className: 'elysium-shot-summary' }, item.shot.action || '未填写动作'), h('small', null, statuses[item.shot.status]))
          })),
        h('footer', { className: 'elysium-pagination' }, h('span', null, `第 ${page + 1}/${pages} 页`), h('button', { disabled: page === 0, onClick: () => change({ page: page - 1 }) }, '上一页'), h('button', { disabled: page + 1 === pages, onClick: () => change({ page: page + 1 }) }, '下一页'),
          currentAct ? h('details', null, h('summary', null, '幕操作'), h('button', { disabled: busy, onClick: () => setEditing({ kind: 'act', title: currentAct.title }) }, '修改幕标题'),
            h('button', { disabled: busy, onClick: async () => { if (window.confirm(`删除幕“${currentAct.title}”及其中所有镜头？`) && await commitActs(project.acts.filter((_, a) => a !== actIndex))) filter({ act: '', selected: null }) } }, '删除幕'),
            h('button', { disabled: busy, onClick: async () => { const shot = { index: 0, role: '', action: '', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' }; if (await commitActs(project.acts.map((act, a) => a === actIndex ? { ...act, shots: [...act.shots, shot] } : act))) change({ act: String(actIndex), q: '', status: '', role: '', selected: `${actIndex}:${currentAct.shots.length}`, page: Math.floor(currentAct.shots.length / 30) }) } }, '添加镜头')) : null)),
      h('aside', { className: 'elysium-shot-detail' }, selected ? h('div', null,
        h('button', { onClick: () => change({ selected: null }) }, '返回镜头列表'), h('h2', null, `镜 ${String(selected.number).padStart(3, '0')} · ${project.acts[selected.a].title}`),
        h('div', { className: 'elysium-panel-actions' }, h('button', { disabled: position <= 0, onClick: () => choose(filtered[position - 1]) }, '上一镜'), h('button', { disabled: position < 0 || position >= filtered.length - 1, onClick: () => choose(filtered[position + 1]) }, '下一镜')),
        editing ? null : h(ShotPreview, { jobId: selected.shot.job_id }),
        h('p', null, `${statuses[selected.shot.status]} · ${anchor?.label || selected.shot.role || '无角色'}`), anchor ? h('details', null, h('summary', null, '角色参考'), anchor.image_url ? h('img', { className: 'elysium-workbench-preview', src: anchor.image_url, alt: anchor.label, loading: 'lazy' }) : null, h('p', null, anchor.description)) : null, h('h3', null, '动作'), h('p', null, selected.shot.action || '未填写'), h('h3', null, '字幕'), h('p', null, selected.shot.subtitle || '未填写'), h('h3', null, '备注'), h('p', null, selected.shot.notes || '无'),
        h('button', { className: 'elysium-primary', disabled: busy, onClick: () => setEditing({ kind: 'shot', ...selected.shot }) }, '编辑镜头'),
        h('details', null, h('summary', null, '更多操作'),
          h('button', { disabled: busy, onClick: () => patchShot({ status: 'pending', notes: [selected.shot.notes, '待重拍'].filter(Boolean).join('\n') }) }, '标记待重拍'),
          h('button', { disabled: busy, onClick: () => { if (window.confirm('解除素材关联？旧素材仍保留在素材库。')) patchShot({ job_id: null, status: 'pending' }) } }, '解除素材关联'),
          h('button', { disabled: busy || selected.i === 0 || Boolean(state.q || state.role || state.status), onClick: () => move(-1), title: '当前幕内移动，筛选时不可用' }, '上移'),
          h('button', { disabled: busy || selected.i === project.acts[selected.a].shots.length - 1 || Boolean(state.q || state.role || state.status), onClick: () => move(1) }, '下移'), h('button', { disabled: busy, onClick: remove }, '移除镜头')),
        h('details', null, h('summary', null, '技术详情'), h('p', null, `模式：${selected.shot.mode}`), h('p', null, `任务 ID：${selected.shot.job_id || '未关联'}`))) : h('p', { className: 'elysium-empty' }, '选择一个镜头，查看画面与详情')),
      editing ? h(Editor, { title: editing.kind === 'shot' ? '编辑镜头' : '编辑幕', initial: editing, fields: editing.kind === 'shot' ? shotFields : [['title', '幕标题']], guard, close: () => setEditing(null), save: async draft => {
        if (editing.kind === 'shot') { const { kind, ...patch } = draft; patch.job_id = patch.job_id?.trim() || null; if (patch.job_id !== selected.shot.job_id) patch.status = 'pending'; return patchShot(patch) }
        return commitActs(editing.kind === 'new-act' ? [...project.acts, { title: draft.title, shots: [] }] : project.acts.map((act, a) => a === actIndex ? { ...act, title: draft.title } : act))
      } }) : null)
  }
  Object.assign(exports, { StoryboardView })
return exports
} })

window.__ModuleLoader__.load({ id: 'elysium-tools/asset-panel', factory: require => { const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { ProjectList } = require('elysium-tools/project')
  const { trapFocus } = require('elysium-tools/dialog')
  const { MaterialList } = require('elysium-tools/asset-list')
  function PanelToggle({ collapsed, onClick }) {
    return h('button', { className: 'elysium-panel-toggle', onClick, 'aria-expanded': !collapsed, 'aria-label': '打开创作工作台' }, '创作工作台')
  }
  function AssetPanel({ toggleRoot }) {
    const [state, setState] = useState(() => {
      let saved = {}
      try { saved = JSON.parse(localStorage.getItem('elysium-workbench')) || {} } catch {}
      return { open: false, activeTab: saved.activeTab || 'projects', selected: saved.selected || null, projectTab: saved.projectTab || null, materials: {}, projects: saved.projects || {} }
    })
    const root = useRef(null), trigger = useRef(null), guard = useRef(null)
    const change = patch => setState(value => ({ ...value, ...patch }))
    const navigate = action => guard.current ? guard.current(action) : action()
    useEffect(() => {
      try { localStorage.setItem('elysium-workbench', JSON.stringify({ activeTab: state.activeTab, selected: state.selected, projectTab: state.projectTab, projects: Object.fromEntries(Object.entries(state.projects).map(([id, value]) => [id, { selected: value.selected, selectedJob: value.selectedJob, tab: value.tab }])) })) } catch {}
    }, [state.activeTab, state.selected, state.projectTab, state.projects])
    useEffect(() => {
      if (!state.open) return
      document.querySelectorAll?.('.elysium-card video').forEach(video => video.pause())
      trigger.current = document.activeElement
      root.current?.focus()
      const pause = () => document.querySelectorAll?.('.elysium-panel video').forEach(video => video.pause())
      const visibility = () => { if (document.hidden) pause() }
      document.addEventListener('visibilitychange', visibility)
      return () => { pause(); document.removeEventListener('visibilitychange', visibility); trigger.current?.focus?.() }
    }, [state.open])
    useEffect(() => { toggleRoot.render(h(PanelToggle, { collapsed: !state.open, onClick: () => navigate(() => change({ open: !state.open })) })) }, [state.open])
    if (!state.open) return null
    return h('section', { className: 'elysium-panel', 'aria-label': '创作工作台', role: 'dialog', 'aria-modal': true, tabIndex: -1, ref: root, onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); navigate(() => change({ open: false })) } else trapFocus(event, root.current) } },
      h('header', { className: 'elysium-panel-header' }, h('strong', null, '创作工作台'),
        ['projects', 'materials'].map(tab => h('button', { key: tab, role: 'tab', 'aria-selected': state.activeTab === tab, onClick: () => navigate(() => change({ activeTab: tab })) }, tab === 'materials' ? '素材' : '项目')),
        h('button', { className: 'elysium-return', onClick: () => navigate(() => change({ open: false })) }, '返回聊天')),
      h('div', { className: 'elysium-panel-body' }, state.activeTab === 'materials'
        ? h(MaterialList, { viewState: state.materials, onViewState: materials => change({ materials }) })
        : h(ProjectList, { viewState: state, onViewState: change, guard, navigate })))
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
