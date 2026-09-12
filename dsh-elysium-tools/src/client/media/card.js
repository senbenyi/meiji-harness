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
        h('path', { d: { play: 'M9 5 19 12 9 19Z', expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5', close: 'm6 6 12 12M18 6 6 18' }[name] }))
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
          h('div', { className: 'elysium-heading' }, h('strong', null, ordinal ? `${title} ${String(ordinal).padStart(2, '0')}` : title)),
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
          h('video', { src: video, controls: true, controlsList: 'nodownload', autoPlay: true })) : null)
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
