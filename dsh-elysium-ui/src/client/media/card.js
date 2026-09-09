window.__ModuleLoader__.load({
  id: 'elysium-ui/media-card', factory: require => {
    const { createElement: h, useEffect, useState, useRef } = require('react')
    const { readStatus, mediaUrl } = require('elysium-ui/media-api')
    const { fromBlock, label } = require('elysium-ui/media-model')
    function MediaTaskCard({ sessionId, callId, block, inspect }) {
      const [expanded, setExpanded] = useState(false)
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
      if (fallback.status === 'rejected') return h('details', { 'aria-label': '媒体提交记录' },
        h('summary', null, '媒体参数校验未通过（未创建任务）'),
        h('p', null, fallback.error), inspect ? h('button', { onClick: inspect }, '查看执行记录') : null)
      const kind = job.media_kind || 'video', title = kind === 'image' ? '图片' : '视频'
      let video
      if (job.status === 'succeeded' && job.comfyui_view_url && !useHarnessMedia) video = job.comfyui_view_url
      else if (job.has_video || job.has_image || useHarnessMedia) {
        try { video = mediaUrl(kind, sessionId, callId) } catch { /* Read error explains unavailable service. */ }
      }
      let download
      if (video) { try { download = mediaUrl(kind, sessionId, callId, true) } catch { /* Direct ComfyUI preview remains available. */ } }
      const info = job.media_info
      const loading = !video && !error && ['pending', 'queued', 'running'].includes(job.status)
      return h('section', { 'aria-label': `${title}任务`, style: { border: '1px solid #8885', borderRadius: 12, padding: 14, margin: '8px 0', maxWidth: 680 } },
        h('strong', { role: 'status', 'aria-live': 'polite' }, `${title} · ${label(job)}`),
        error ? h('p', { role: 'alert' }, error, ' ', h('button', { onClick: () => setAttempt(n => n + 1) }, '重新连接')) : null,
        job.status === 'failed' ? h('p', { role: 'alert' }, job.error || '任务失败，请查看详情。', ' 原任务已保留；解决原因后可继续。') : null,
        info ? h('p', null, kind === 'image' ? `${info.width}×${info.height}` : `${info.duration_seconds} 秒 · ${info.width}×${info.height} · ${info.frame_rate} fps`) : null,
        job.status === 'succeeded' ? h('p', null, job.validation?.full_decode === 'passed' && job.validation?.specification_match === 'passed' ? '文件与规格检查通过' : '文件检查状态请查看详情',
          job.validation?.human_review === 'passed' ? ' · 已人工验收' : ' · 画面和声音尚未人工验收') : null,
        h('details', null, h('summary', null, '任务详情'),
          job.job_id ? h('p', null, '任务 ID：', h('code', null, job.job_id)) : null,
          inspect ? h('button', { onClick: inspect }, '查看执行记录') : null),
        loading ? h('div', { role: 'progressbar', 'aria-label': `${title}生成中`, style: { padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#8881', borderRadius: 8, marginTop: 12 } },
          h('svg', { width: 36, height: 36, viewBox: '0 0 40 40', 'aria-hidden': true },
            h('circle', { cx: 20, cy: 20, r: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeDasharray: '70 31' },
              h('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 20 20', to: '360 20 20', dur: '1s', repeatCount: 'indefinite' }))),
          h('span', null, '拼命加载中')) : null,
        video ? h(kind === 'image' ? 'img' : 'video', { key: video + attempt, src: video, ...(kind === 'image' ? { alt: '生成图片' } : { controls: false, muted: true, preload: 'metadata', onClick: () => setExpanded(true) }),
          onError: async () => {
            if (!useHarnessMedia && job.comfyui_view_url) {
              try { mediaUrl(kind, sessionId, callId); setUseHarnessMedia(true); return } catch { /* Show the playback error when the media service is unavailable. */ }
            }
            try {
              const current = await readStatus(sessionId, callId)
              if (mediaUrl(kind, sessionId, callId) !== video) { setJob(current); setPlaybackError(false); return }
            } catch { /* Report a playback failure if credentials cannot be recovered. */ }
            setPlaybackError(true)
          }, style: { width: 'auto', height: 'auto', maxWidth: kind === 'video' ? 160 : '100%', maxHeight: kind === 'video' ? 180 : undefined, cursor: kind === 'video' ? 'pointer' : undefined, objectFit: 'contain', display: 'block', borderRadius: 8, marginTop: 12 } }) : null,
        video && kind === 'video' ? h('button', { onClick: () => setExpanded(true), style: { marginTop: 8 } }, '放大查看') : null,
        expanded && video && kind === 'video' ? h('dialog', { ref: dialog, 'aria-label': '视频预览', onClose: () => setExpanded(false),
          style: { maxWidth: '90vw', maxHeight: '90vh', padding: 12, borderRadius: 12 },
          onClick: event => { if (event.target === event.currentTarget) setExpanded(false) } },
          h('button', { autoFocus: true, onClick: () => setExpanded(false) }, '关闭'),
          h('video', { src: video, controls: true, autoPlay: true, style: { display: 'block', maxWidth: '85vw', maxHeight: '80vh', marginTop: 8 } })) : null,
        kind === 'image' && download ? h('a', { href: download, download: true }, '下载产物') : null,
        playbackError ? h('p', { role: 'alert' }, `${title}加载失败，可重新连接或下载查看。`, h('button', { onClick: () => setAttempt(n => n + 1) }, '重试播放')) : null)
    }
    return { apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => {
        for (const key of ['workflow_generate_video', 'workflow_resume_video', 'model_generate_video', 'model_generate_video_long', 'model_generate_image', 'model_concat_video', 'model_job_resume']) ctx.slots.register({ name: 'tool.call.toolview', key }, MediaTaskCard)
      })
    } }
  },
})
