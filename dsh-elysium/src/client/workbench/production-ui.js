// 职责：展示六个制作阶段及可横向浏览的 Scene、Segment 和版本卡片。
window.__ModuleLoader__.load({ id: 'elysium/production-ui', factory: require => {
  const { createElement: h } = require('react')
  const inputFor = s => s.inputs.findLast(i => i.source_revision === s.revision && s.shots_revision === s.revision)
  const videoFor = s => s.generations.find(g => g.id === s.selected_generation) || s.generations.findLast(g => g.status === 'succeeded')
  function productionStatuses(p, session) {
    const count = p.segments.length, storyReady = p.story.scenes.length && !p.story.stale && Math.abs(p.story.scenes.reduce((n, s) => n + s.duration, 0) - p.target_seconds) <= 30
    const segmentsReady = count && storyReady && p.segments.every(s => !s.story_stale)
    const shots = p.segments.filter(s => s.shots.length && s.shots_revision === s.revision).length
    const inputs = p.segments.filter(s => inputFor(s)).length
    const videos = p.segments.filter(s => !s.tail_stale && inputFor(s) && videoFor(s)?.url && (videoFor(s).input_id === inputFor(s).id || s.selected_for_input === inputFor(s).id)).length
    const result = {
      description: { status: p.requirements?.trim() ? '已完成' : '未开始' },
      story: { status: p.story.scenes.length ? storyReady ? '已完成' : '未开始' : '未开始' },
      segments: { status: count ? segmentsReady ? '已完成' : '未开始' : '未开始' },
      shots: { status: shots && segmentsReady ? shots === count ? '已完成' : '部分完成' : p.segments.some(s => s.shots.length) ? '未开始' : '未开始' },
      inputs: { status: inputs && segmentsReady ? inputs === count ? '已完成' : '部分完成' : p.segments.some(s => s.inputs.length) ? '未开始' : '未开始' },
      videos: { status: videos && segmentsReady ? videos === count ? '已完成' : '部分完成' : p.segments.some(s => s.generations.length) ? '未开始' : '未开始' },
      compose: { status: '未开始' },
    }
    for (const stage of ['story', 'segments', 'shots', 'inputs']) {
      const run = p.stage_runs?.[stage], request = p.request?.stage === stage ? p.request : null
      if (request) result[stage] = { status: request.interrupted ? '已中断' : session?.running ? '生成中' : run?.status === 'failed' || session?.error ? '生成失败' : session?.ready ? '已中断' : '状态同步中',
        detail: `已保存 ${request.batch?.index || 0} 批 / ${request.batch?.items.length || 0} 项${run?.error || session?.error ? ` · ${run?.error || session.error}` : request.interrupted || session?.ready && !session.running ? ' · 等待点击继续或重新执行' : ''}` }
      else if (['failed', 'cancelled'].includes(run?.status)) result[stage] = { status: run.status === 'failed' ? '生成失败' : '已取消', detail: run.error }
    }
    const q = p.queue, queueStatus = { interrupted: '已中断', running: '生成中', paused: '已暂停', stopping: '停止中', failed: '生成失败', cancelled: '已取消' }
    if (queueStatus[q?.status]) result.videos = { status: queueStatus[q.status], detail: `队列完成 ${q.cursor}/${q.items.length}${q.error ? ` · ${q.error}` : ''}` }
    const latest = p.exports.at(-1), outputs = latest ? p.exports.filter(e => e.batch_id ? e.batch_id === latest.batch_id : e.id === latest.id) : []
    if (latest) {
      const stale = !segmentsReady || videos !== count || outputs.some(e => e.timeline.clips.some(c => videoFor(p.segments.find(s => s.id === c.segment_id) || { generations: [] })?.id !== c.generation_id))
      result.compose = { status: outputs.some(e => e.status === 'interrupted') ? '已中断' : outputs.some(e => ['pending', 'running'].includes(e.status)) ? '生成中' : outputs.some(e => e.status === 'failed') ? '生成失败' : outputs.some(e => e.status === 'superseded') ? '已取消' : stale ? '未开始' : '已完成', detail: `成片完成 ${outputs.filter(e => e.status === 'succeeded').length}/${outputs.length}${outputs.find(e => e.error)?.error ? ` · ${outputs.find(e => e.error).error}` : ''}` }
    }
    return result
  }
  function Rail({ label, items, open, describe, current = () => '', empty = '还未生成' }) {
    return h('div', { className: 'elysium-episode-rail', role: 'region', 'aria-label': label, tabIndex: 0 }, items.length
      ? items.map((item, i) => h('button', { key: item.id, className: 'elysium-episode-card', onClick: () => open(item), 'aria-label': `打开${label} ${i + 1}` },
        h('span', { className: 'elysium-episode-placeholder', 'aria-hidden': true }, String(i + 1).padStart(2, '0')),
        h('strong', null, item.title || `${label} ${i + 1}`), h('span', { className: 'elysium-step-status' }, current(item)), h('span', { className: 'elysium-episode-excerpt' }, describe(item))))
      : h('div', { className: 'elysium-episode-card elysium-rail-placeholder', role: 'status' }, h('span', { className: 'elysium-episode-placeholder', 'aria-hidden': true }, '—'), h('strong', null, empty)))
  }

  function Step({ number, title, children, next, disabled, action, progress, status, detail, retry, retryLabel = '重新执行', retryDisabled, model, onOpen }) {
    return h('section', { className: 'elysium-episode-section elysium-production-step', 'aria-label': title, 'data-openable': onOpen ? true : undefined,
      onClick: onOpen ? event => { if (!event?.target?.closest?.('button, a, input, select, textarea, label')) onOpen() } : undefined },
      h('header', null, h('div', { className: 'elysium-step-title' },
        h('div', { className: 'elysium-step-title-row' }, h('h2', null, `${number}. ${title}`), status ? h('span', { className: 'elysium-step-status', 'data-status': status, role: 'status' }, status) : null), model || null),
        next || retry ? h('div', { className: 'elysium-step-actions' }, retry ? h('button', { disabled: retryDisabled, onClick: retry }, retryLabel) : null, next ? h('button', { className: 'elysium-primary', disabled, onClick: action, 'aria-label': `执行${title}` }, '执行') : null) : null), children,
      progress ? h('p', { role: 'status' }, progress) : null, detail ? h('p', { className: 'elysium-stage-detail', role: 'status' }, detail) : null)
  }
  return { Rail, Step, inputFor, videoFor, productionStatuses }
} })
