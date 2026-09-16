// 职责：展示自有模型的连接操作及无需连接的三方模型。
load('elysium/servers', (require, exports) => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { serverRequest } = require('elysium/server-api')
  const labels = { llm: '文本模型', analysis: '分析模型', image: '图片模型', video: '视频模型' }
  function ServerList() {
    const probes = useRef({})
    const [data, setData] = useState(null), [selected, setSelected] = useState({})
    const [status, setStatus] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(null)
    useEffect(() => {
      const controller = new AbortController()
      serverRequest('models', null, controller.signal).then(value => {
        setData(value); setSelected(value.selected)
        for (const kind of Object.keys(labels)) {
          const id = value.selected[kind], key = `${kind}:${id}`
          if (!id) continue
          const probe = probes.current[kind] = new AbortController()
          serverRequest('model-status', { kind, id }, probe.signal).then(value => {
            if (!probe.signal.aborted) setStatus(current => ({ ...current, [key]: value.connected }))
          }).catch(() => { if (!probe.signal.aborted) setStatus(current => ({ ...current, [key]: false })) })
        }
      }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      return () => { controller.abort(); Object.values(probes.current).forEach(probe => probe.abort()) }
    }, [])
    async function connect(kind) {
      if (busy) return
      const id = selected[kind], key = `${kind}:${id}`
      probes.current[kind]?.abort()
      setBusy(kind); setError('')
      try {
        const value = await serverRequest('model-connect', { kind, id, revision: data.revision })
        setData(current => ({ ...current, revision: value.revision ?? current.revision, selected: { ...current.selected, [kind]: id }, pending_llm: kind === 'llm' ? value.pending : current.pending_llm }))
        setStatus(current => ({ ...current, [key]: value.connected }))
      } catch (error) { setStatus(current => ({ ...current, [key]: false })); setError(error.message) }
      finally { setBusy(null) }
    }
    return h('section', { className: 'elysium-server-list', 'aria-label': '模型设置' },
      h('h2', null, '私有模型'),
      Object.entries(labels).map(([kind, label]) => {
        const entries = data?.models[kind] || [], id = selected[kind] || '', key = `${kind}:${id}`
        const connected = id === data?.selected[kind] && status[key] === true
        return h('div', { key: kind, className: 'elysium-model-row' },
          h('label', { htmlFor: `elysium-model-${kind}` }, `${label}：`),
          h('select', { id: `elysium-model-${kind}`, 'aria-label': label, value: id, disabled: !!busy || !entries.length, onChange: event => { setSelected(current => ({ ...current, [kind]: event.target.value })); setError('') } },
            !entries.length ? h('option', { value: '' }, '') : entries.map(model => h('option', { key: model.id, value: model.id }, model.label))),
          entries.length ? h('button', { type: 'button', 'aria-label': `${connected ? '重新连接' : '连接'}${label}`, disabled: !!busy, onClick: () => connect(kind) }, busy === kind ? '连接中' : connected ? '重新连接' : '连接') : null)
      }),
      data?.third_party_channels ? h('section', { 'aria-label': '三方模型' }, h('h2', null, '三方模型'),
        data.third_party_channels.map(channel => h('div', { key: channel.id, className: 'elysium-model-row' },
          h('span', null, channel.label),
          h('span', null, channel.enabled ? channel.preferred ? '已启用 · 三方视频首选' : '已启用' : '已关闭'),
          channel.models.length ? h('span', null, channel.models.join(' / ')) : null))) : null,
      data?.pending_llm ? h('p', { role: 'status' }, '文本模型待重启生效') : null,
      error ? h('p', { role: 'alert' }, error) : null)
  }
  exports.ServerList = ServerList
})
