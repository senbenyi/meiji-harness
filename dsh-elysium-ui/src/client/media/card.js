window.__ModuleLoader__.load({
  id: 'elysium-ui/media-card', factory: require => {
    const { createElement: h, useEffect, useState } = require('react')
    const { readStatus, mediaUrl } = require('elysium-ui/media-api')
    const { fromBlock, label } = require('elysium-ui/media-model')
    function VideoTaskCard({ sessionId, callId, block, inspect }) {
      const fallback = fromBlock(block)
      const [job, setJob] = useState(fallback)
      const [error, setError] = useState('')
      const [attempt, setAttempt] = useState(0)
      const [playbackError, setPlaybackError] = useState(false)
      useEffect(() => {
        let active = true, timer, failures = 0
        const controller = new AbortController()
        setJob(fromBlock(block)); setError(''); setPlaybackError(false)
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
      }, [sessionId, callId, block?.kind, block?.isError, attempt])
      let video
      if (job.has_video) {
        try { video = mediaUrl('video', sessionId, callId) } catch { /* Read error explains unavailable service. */ }
      }
      const info = job.media_info
      return h('section', { 'aria-label': '视频任务', style: { border: '1px solid #8885', borderRadius: 12, padding: 14, margin: '8px 0', maxWidth: 680 } },
        h('strong', { role: 'status', 'aria-live': 'polite' }, `视频 · ${label(job)}`),
        error ? h('p', { role: 'alert' }, error, ' ', h('button', { onClick: () => setAttempt(n => n + 1) }, '重新连接')) : null,
        job.status === 'failed' ? h('p', { role: 'alert' }, job.error || '任务失败，请查看详情。', ' 原任务已保留；解决原因后可继续。') : null,
        video ? h('video', { key: video + attempt, src: video, controls: true, preload: 'metadata',
          onError: () => setPlaybackError(true), style: { width: '100%', display: 'block', borderRadius: 8, marginTop: 12 } }) : null,
        playbackError ? h('p', { role: 'alert' }, '视频加载失败，可重新连接或下载查看。', h('button', { onClick: () => setAttempt(n => n + 1) }, '重试播放')) : null,
        info ? h('p', null, `${info.duration_seconds} 秒 · ${info.width}×${info.height} · ${info.frame_rate} fps`) : null,
        job.status === 'succeeded' ? h('p', null, job.validation?.full_decode === 'passed' && job.validation?.specification_match === 'passed' ? '文件与规格检查通过' : '文件检查状态请查看详情',
          job.validation?.human_review === 'passed' ? ' · 已人工验收' : ' · 画面和声音尚未人工验收') : null,
        video ? h('a', { href: mediaUrl('video', sessionId, callId, true), download: 'video.mp4' }, '下载视频') : null,
        h('details', null, h('summary', null, '任务详情'),
          job.job_id ? h('p', null, '任务 ID：', h('code', null, job.job_id)) : null,
          inspect ? h('button', { onClick: inspect }, '查看执行记录') : null))
    }
    return { apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => {
        for (const key of ['workflow_generate_video', 'workflow_resume_video']) ctx.slots.register({ name: 'tool.call.toolview', key }, VideoTaskCard)
      })
    } }
  },
})
