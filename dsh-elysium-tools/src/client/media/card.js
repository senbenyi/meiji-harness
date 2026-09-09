window.__ModuleLoader__.load({
  id: 'elysium-tools/media-card', factory: require => {
    const { createElement: h, useEffect, useState, useRef } = require('react')
    const { readStatus, mediaUrl } = require('elysium-tools/media-api')
    const { fromBlock, label } = require('elysium-tools/media-model')
    function MediaTaskCard({ sessionId, callId, block, inspect }) {
      const [expanded, setExpanded] = useState(false)
      const [mediaReady, setMediaReady] = useState(false)
      const dialog = useRef(null)
      useEffect(() => {
        if (expanded) dialog.current?.showModal()
      }, [expanded])
      const fallback = fromBlock(block)
      const [job, setJob] = useState(fallback)
      const [error, setError] = useState('')
      const [attempt, setAttempt] = useState(0)
      const [playbackError, setPlaybackError] = useState(false)
      const [useHarnessMedia, setUseHarnessMedia] = useState(false)
      useEffect(() => {
        if (fallback.status === 'rejected') return
        let active = true, timer, failures = 0
        const controller = new AbortController()
        setJob(fromBlock(block)); setError(''); setPlaybackError(false); setUseHarnessMedia(false)
        if (fallback.status === 'succeeded' && fallback.comfyui_view_url) return
        async function poll() {
          let delay = 3000
          try {
            const current = await readStatus(sessionId, callId, controller.signal)
            if (!active) return
            const value = current.status === 'pending' && fallback.status !== 'pending' ? fallback : current
            setJob(value); setError(''); failures = 0
            if (['succeeded', 'failed'].includes(value.status)) return
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
      const kind = job.media_kind || 'video', title = kind === 'image' ? '图片' : '视频'
      let video
      if (job.status === 'succeeded' && job.comfyui_view_url && !useHarnessMedia) video = job.comfyui_view_url
      else if (job.has_video || job.has_image || useHarnessMedia) {
        try { video = mediaUrl(kind, sessionId, callId) } catch { /* Read error explains unavailable service. */ }
      }
      let download
      if (video) { try { download = mediaUrl(kind, sessionId, callId, true) } catch { /* Direct ComfyUI preview remains available. */ } }
      useEffect(() => { setMediaReady(false) }, [video, attempt])
      if (fallback.status === 'rejected') return h('details', { 'aria-label': '媒体提交记录' },
        h('summary', null, '媒体参数校验未通过（未创建任务）'),
        h('p', null, fallback.error), inspect ? h('button', { onClick: inspect }, '查看执行记录') : null)
      const info = job.media_info
      const loading = !video && !error && ['pending', 'queued', 'running'].includes(job.status)
      const overlayButton = { position: 'absolute', display: 'grid', placeItems: 'center', padding: 0, background: '#0009', color: '#fff', border: '1px solid #ffffff40', cursor: 'pointer' }
      const portrait = info?.width && info?.height ? info.height > info.width : true
      return h('section', { 'aria-label': `${title}任务`, style: { boxSizing: 'border-box', border: '1px solid #8883', borderRadius: 12, padding: 12, margin: '12px 0', width: '100%', maxWidth: portrait ? 300 : 560, fontSize: 13, lineHeight: 1.5 } },
        video ? h('div', { style: { position: 'relative', aspectRatio: info?.width && info?.height ? `${info.width} / ${info.height}` : '9 / 16', background: '#161616', borderRadius: 8, overflow: 'hidden' } }, h(kind === 'image' ? 'img' : 'video', { key: video + attempt, src: video, onLoadedData: () => setMediaReady(true), onLoad: () => setMediaReady(true), ...(kind === 'image' ? { alt: '生成图片' } : { controls: false, muted: true, preload: 'metadata', onClick: () => setExpanded(true) }),
          onError: async () => {
            if (!useHarnessMedia && job.comfyui_view_url) {
              try { mediaUrl(kind, sessionId, callId); setUseHarnessMedia(true); return } catch { /* Show the playback error when the media service is unavailable. */ }
            }
            try {
              const current = await readStatus(sessionId, callId)
              if (mediaUrl(kind, sessionId, callId) !== video) { setJob(current); setPlaybackError(false); return }
            } catch { /* Report a playback failure if credentials cannot be recovered. */ }
            setPlaybackError(true)
          }, style: { width: '100%', height: '100%', maxWidth: '100%', cursor: kind === 'video' ? 'pointer' : undefined, objectFit: 'contain', display: 'block', borderRadius: 8 } }),
          !mediaReady && !playbackError ? h('div', { role: 'progressbar', 'aria-label': '媒体加载中', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#bbb', background: '#161616' } }, '正在加载预览…') : null,
          kind === 'video' && mediaReady ? h('button', { 'aria-label': '播放视频', onClick: () => setExpanded(true), style: { ...overlayButton, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 52, height: 52, borderRadius: '50%', fontSize: 22 } }, '▶') : null,
          kind === 'video' ? h('button', { 'aria-label': '放大查看', title: '放大查看', onClick: () => setExpanded(true), style: { ...overlayButton, right: 10, bottom: 10, width: 32, height: 32, borderRadius: 6, fontSize: 20 } }, '⛶') : null) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: video ? 12 : 0 } },
          h('strong', { style: { fontSize: 15 } }, `生成${title}`),
          h('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: 12, color: job.status === 'succeeded' ? '#46a87b' : 'inherit' } }, label(job))),
        error ? h('p', { role: 'alert' }, error, ' ', h('button', { onClick: () => setAttempt(n => n + 1) }, '重新连接')) : null,
        job.status === 'failed' ? h('p', { role: 'alert' }, job.error || '任务失败，请查看详情。', ' 原任务已保留；解决原因后可继续。') : null,
        info ? h('p', { style: { margin: '6px 0 0', opacity: 0.65, fontSize: 12 } }, kind === 'image' ? `${info.width}×${info.height}` : `${info.duration_seconds} 秒 · ${info.width}×${info.height} · ${info.frame_rate} fps${info.has_audio ? ' · 含音频' : ''}`) : null,
        h('details', { style: { marginTop: 12, paddingTop: 10, borderTop: '1px solid #8882', fontSize: 12, overflowWrap: 'anywhere' } }, h('summary', { style: { cursor: 'pointer', opacity: 0.65 } }, '任务详情'),
          job.status === 'succeeded' ? h('p', null, job.validation?.full_decode === 'passed' && job.validation?.specification_match === 'passed' ? '文件与规格检查通过' : '文件检查状态请查看详情',
            job.validation?.human_review === 'passed' ? ' · 已人工验收' : ' · 画面和声音尚未人工验收') : null,
          job.job_id ? h('p', null, '任务 ID：', h('code', null, job.job_id)) : null,
          inspect ? h('button', { onClick: inspect }, '查看执行记录') : null),
        loading ? h('div', { role: 'progressbar', 'aria-label': `${title}生成中`, style: { padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#8881', borderRadius: 8, marginTop: 12 } },
          h('svg', { width: 36, height: 36, viewBox: '0 0 40 40', 'aria-hidden': true },
            h('circle', { cx: 20, cy: 20, r: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeDasharray: '70 31' },
              h('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 20 20', to: '360 20 20', dur: '1s', repeatCount: 'indefinite' }))),
          h('span', null, '正在制作，请稍候')) : null,
        expanded && video && kind === 'video' ? h('dialog', { ref: dialog, 'aria-label': '视频预览', onClose: () => setExpanded(false),
          style: { maxWidth: '90vw', maxHeight: '90vh', padding: 8, borderRadius: 12, border: '1px solid #ffffff30', outline: 'none', background: '#111', color: '#fff' },
          onClick: event => { if (event.target === event.currentTarget) setExpanded(false) } },
          h('button', { autoFocus: true, 'aria-label': '关闭', onClick: () => setExpanded(false), style: { ...overlayButton, top: 14, right: 14, width: 30, height: 30, borderRadius: '50%', fontSize: 20, zIndex: 1 } }, '×'),
          h('video', { src: video, controls: true, autoPlay: true, style: { display: 'block', maxWidth: '85vw', maxHeight: '85vh', borderRadius: 6 } })) : null,
        kind === 'image' && download ? h('a', { href: download, download: true }, '下载产物') : null,
        playbackError ? h('p', { role: 'alert' }, `${title}加载失败，可重新连接或下载查看。`, h('button', { onClick: () => setAttempt(n => n + 1) }, '重试播放')) : null)
    }
    return { MediaTaskCard, apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => {
        for (const key of ['workflow_generate_video', 'workflow_resume_video', 'model_generate_video', 'model_generate_video_long', 'model_generate_image', 'model_concat_video', 'model_job_resume']) ctx.slots.register({ name: 'tool.call.toolview', key }, props => fromBlock(props.block).status === 'succeeded'
          ? h('span', { style: { fontSize: 13, opacity: 0.65 } }, '媒体已生成 · 作品见本轮回复下方')
          : h(MediaTaskCard, props))
      })
    } }
  },
})
