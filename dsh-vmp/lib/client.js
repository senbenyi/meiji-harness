window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-vmp',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const inject = ['slots']
    const API = '/vmp/api'

    const styles = `
.vmp-root{height:100%;overflow:auto;padding:14px;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--theme-text,#ddd)}
.vmp-root *{box-sizing:border-box}.vmp-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}.vmp-title{font-size:16px;font-weight:700;flex:1}
.vmp-hero{padding:14px;margin-bottom:12px;border:1px solid #4a9eff55;border-radius:10px;background:linear-gradient(135deg,#4a9eff18,#7c4dff12)}
.vmp-kicker{font-size:9px;letter-spacing:1.4px;color:#64b5f6}.vmp-name{font-size:18px;font-weight:700;margin:5px 0}.vmp-meta{font-size:11px;opacity:.65}
.vmp-field{display:flex;flex-direction:column;gap:4px;margin:10px 0;font-size:11px;font-weight:600;opacity:.85}.vmp-input{width:100%;padding:7px 9px;border:1px solid var(--theme-border,#80808050);border-radius:6px;background:var(--theme-input-bg,#80808018);color:inherit;font:inherit}
.vmp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:12px 0}.vmp-state{display:flex;justify-content:space-between;padding:8px 10px;border:1px solid var(--theme-border,#80808030);border-radius:7px;font-size:11px}.vmp-complete{color:#81c784;border-color:#2e7d3250;background:#2e7d3212}.vmp-running,.vmp-syncing{color:#ffb74d;border-color:#f57f1750;background:#f57f1712}.vmp-failed{color:#ef5350;border-color:#c6282850;background:#c6282812}
.vmp-buttons{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.vmp-btn{cursor:pointer;padding:6px 11px;border:0;border-radius:6px;background:#4a9eff;color:#fff;font:inherit}.vmp-btn.ghost{background:transparent;border:1px solid var(--theme-border,#80808050);color:inherit}.vmp-btn:disabled{opacity:.35;cursor:not-allowed}
.vmp-confirm{display:flex;align-items:flex-start;gap:8px;padding:10px;margin:10px 0;border:1px solid var(--theme-border,#80808030);border-radius:7px;font-size:11px}.vmp-confirm input{margin-top:3px}.vmp-error{padding:8px 10px;margin:8px 0;border:1px solid #c6282860;border-radius:6px;background:#c6282815;color:#ef5350;font-size:11px}
.vmp-output{padding-top:12px;margin-top:14px;border-top:1px solid var(--theme-border,#80808030)}.vmp-video{display:block;width:100%;max-height:62vh;margin:8px 0;border-radius:8px;background:#000}.vmp-log{max-height:230px;overflow:auto;padding:9px;border-radius:7px;background:#0005;font:10px/1.55 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
`

    function fetchJson(route, payload = {}) {
      return fetch(API + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then(async response => {
          const value = await response.json().catch(() => ({}))
          if (!response.ok || value.ok === false) throw new Error(value.error || ('HTTP ' + response.status))
          return value
        })
    }

    function button(label, action, disabled, ghost) {
      return h('button', { className: 'vmp-btn' + (ghost ? ' ghost' : ''), disabled, onClick: action, type: 'button' }, label)
    }

    function VmpApp() {
      const [specs, setSpecs] = React.useState([])
      const [spec, setSpec] = React.useState('')
      const [status, setStatus] = React.useState(null)
      const [job, setJob] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [authorized, setAuthorized] = React.useState(false)
      const [reviewed, setReviewed] = React.useState(false)
      const [reviewer, setReviewer] = React.useState('')
      const [synced, setSynced] = React.useState(false)

      const refreshStatus = React.useCallback(() => {
        if (!spec) return Promise.resolve()
        return fetchJson('/status', { spec }).then(value => { setStatus(value); setError('') }).catch(cause => setError(cause.message))
      }, [spec])
      const refreshJob = React.useCallback(() => {
        if (!spec) return Promise.resolve()
        return fetchJson('/job', { spec }).then(value => {
          setJob(value.job)
          if (value.job?.status === 'complete') {
            setSynced(Boolean(value.job.result?.technical_complete))
            return refreshStatus()
          }
          return undefined
        }).catch(cause => setError(cause.message))
      }, [spec, refreshStatus])

      React.useEffect(() => {
        fetchJson('/list').then(value => {
          setSpecs(value.specs || [])
          setSpec(current => current || value.specs?.find(item => !item.invalid)?.name || '')
        }).catch(cause => setError(cause.message))
      }, [])
      React.useEffect(() => { if (spec) void refreshStatus() }, [spec, refreshStatus])
      React.useEffect(() => {
        if (job?.status !== 'running' && job?.status !== 'syncing') return undefined
        const timer = window.setInterval(() => void refreshJob(), 2500)
        return () => window.clearInterval(timer)
      }, [job?.status, refreshJob])

      async function check() {
        if (!spec) return
        setBusy(true)
        try { await fetchJson('/check', { spec }); setError(''); await refreshStatus() }
        catch (cause) { setError(cause.message) } finally { setBusy(false) }
      }
      async function run(stage) {
        if (!spec) return
        setBusy(true)
        try {
          const value = await fetchJson('/run', { spec, stage, confirmed: authorized,
            reviewer: reviewer.trim(), reviewConfirmed: reviewed })
          setJob(value.job); setError(''); setSynced(false)
        } catch (cause) { setError(cause.message) } finally { setBusy(false) }
      }
      async function sync() {
        setBusy(true)
        try { await fetchJson('/sync', { spec }); setSynced(true); setError('') }
        catch (cause) { setError(cause.message) } finally { setBusy(false) }
      }

      const running = busy || job?.status === 'running' || job?.status === 'syncing'
      const selected = specs.find(item => item.name === spec)
      const stages = status?.stages || {}
      const finalReady = Boolean(status?.technical_complete)
      const stateRows = [
        ['图片', stages.images?.status || 'pending'], ['视频', stages.video?.status || 'pending'],
        ['技术 QC', finalReady ? 'complete' : (stages.final?.status || 'pending')],
        ['人工验收', status?.delivery_complete ? 'complete' : 'pending'],
      ]
      return h('div', { className: 'vmp-root' },
        h('style', null, styles),
        h('div', { className: 'vmp-head' }, h('span', { className: 'vmp-title' }, 'VMP 视频工厂'),
          button('刷新', refreshStatus, running || !spec, true)),
        h('div', { className: 'vmp-hero' },
          h('div', { className: 'vmp-kicker' }, 'ONE SPEC · ONE PIPELINE · ONE DELIVERY'),
          h('div', { className: 'vmp-name' }, selected?.title || '在聊天框创建一集原创短视频'),
          h('div', { className: 'vmp-meta' }, selected ? `${selected.episodeId} · ${selected.profile}` : '固定 12 镜；可恢复；技术和人工双验收。')),
        error ? h('div', { className: 'vmp-error' }, error) : null,
        h('label', { className: 'vmp-field' }, '生产规格', h('select', { className: 'vmp-input', value: spec, disabled: running,
          onChange: event => { setSpec(event.target.value); setJob(null); setStatus(null); setSynced(false) } },
        specs.length ? null : h('option', { value: '' }, '暂无 spec，请先在聊天框创建'),
        specs.map(item => h('option', { key: item.name, value: item.name, disabled: item.invalid }, item.invalid ? `${item.name}（无效）` : `${item.title} · ${item.profile}`)))),
        h('div', { className: 'vmp-grid' }, stateRows.map(([label, value]) => h('div', { className: `vmp-state vmp-${value}`, key: label }, h('span', null, label), h('strong', null, value)))),
        h('div', { className: 'vmp-buttons' },
          button('检查', check, running || !spec, true),
          button('生成图片', () => run('images'), running || !spec || !authorized),
          button('生成视频', () => run('video'), running || !spec || !authorized),
          button('一键成片', () => run('all'), running || !spec || !authorized),
          button('仅成片 QC', () => run('final'), running || !spec, true),
          finalReady ? button('同步成片', sync, running, true) : null),
        h('label', { className: 'vmp-confirm' },
          h('input', { type: 'checkbox', checked: authorized, disabled: running, onChange: event => setAuthorized(event.target.checked) }),
          h('span', null, '已确认全部角色为虚构成年人、参与者年满 18 岁、内容自愿、素材权利完整，并授权本次远端 GPU 成本。')),
        finalReady && synced ? h('div', { className: 'vmp-output' },
          h('strong', null, '当前成片'),
          h('video', { className: 'vmp-video', controls: true, preload: 'metadata', src: `/vmp/file?spec=${encodeURIComponent(spec)}&artifact=final` }),
          h('a', { className: 'vmp-btn ghost', target: '_blank', rel: 'noreferrer', href: `/vmp/file?spec=${encodeURIComponent(spec)}&artifact=qc` }, '查看 QC'),
          h('label', { className: 'vmp-field' }, '验收人', h('input', { className: 'vmp-input', value: reviewer, maxLength: 80,
            placeholder: 'operator-name', disabled: running, onChange: event => setReviewer(event.target.value) })),
          h('label', { className: 'vmp-confirm' }, h('input', { type: 'checkbox', checked: reviewed, disabled: running,
            onChange: event => setReviewed(event.target.checked) }), h('span', null, '我已完整观看并确认人物一致性、肢体结构、镜头语义、内容合规和交付可用性。')),
          button('登记人工验收', () => run('approve'), running || !reviewed || !/^[A-Za-z0-9._-]{1,80}$/.test(reviewer)))
          : null,
        job ? h('div', { className: 'vmp-output' },
          h('div', { className: `vmp-state vmp-${job.status}` }, h('span', null, `任务 · ${job.stage}`), h('strong', null, job.status)),
          job.error ? h('div', { className: 'vmp-error' }, job.error) : null,
          h('pre', { className: 'vmp-log' }, job.log || '等待输出…')) : null)
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: 'vmp-video-factory', order: 30,
        label: () => 'VMP 工厂',
      }, VmpApp))
    }

    Object.assign(exports, { inject, apply })
    return module.exports
  },
})
