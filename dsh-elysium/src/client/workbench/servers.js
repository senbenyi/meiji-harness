// 职责：展示系统配置的三类模型、连接状态和连接操作。
load('elysium/servers', (require, exports) => {
  const { createElement: h, useState, useEffect } = require('react')
  const { serverRequest } = require('elysium/server-api')
  const labels = { llm: '聊天模型', image: '图片模型', video: '视频模型' }
  function ServerList() {
    const [data, setData] = useState(null), [selected, setSelected] = useState({})
    const [status, setStatus] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(null)
    useEffect(() => {
      const controller = new AbortController()
      serverRequest('models', null, controller.signal).then(value => {
        setData(value); setSelected(value.selected)
      }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      return () => controller.abort()
    }, [])
    useEffect(() => {
      if (!data) return
      const controller = new AbortController()
      for (const kind of Object.keys(labels)) {
        const id = selected[kind], key = `${kind}:${id}`
        if (!id || id !== data.selected[kind]) continue
        serverRequest('model-status', { kind, id }, controller.signal).then(value => {
          if (!controller.signal.aborted) setStatus(current => ({ ...current, [key]: value.connected }))
        }).catch(() => { if (!controller.signal.aborted) setStatus(current => ({ ...current, [key]: false })) })
      }
      return () => controller.abort()
    }, [data, selected])
    async function connect(kind) {
      if (busy) return
      const id = selected[kind], key = `${kind}:${id}`
      setBusy(kind); setError('')
      try {
        const value = await serverRequest('model-connect', { kind, id, revision: data.revision })
        const updated = await serverRequest('models')
        setData(updated); setStatus(current => ({ ...current, [key]: value.connected }))
      } catch (error) { setStatus(current => ({ ...current, [key]: false })); setError(error.message) }
      finally { setBusy(null) }
    }
    return h('section', { className: 'elysium-server-list', 'aria-label': '模型设置' },
      h('h2', null, '模型'),
      Object.entries(labels).map(([kind, label]) => {
        const entries = data?.models[kind] || [], id = selected[kind] || '', key = `${kind}:${id}`
        const connected = id === data?.selected[kind] && status[key] === true
        const checking = !!id && id === data?.selected[kind] && status[key] === undefined
        return h('div', { key: kind, className: 'elysium-model-row' },
          h('label', { htmlFor: `elysium-model-${kind}` }, `${label}：`),
          h('select', { id: `elysium-model-${kind}`, 'aria-label': label, value: id, disabled: !!busy || !entries.length, onChange: event => { setSelected(current => ({ ...current, [kind]: event.target.value })); setError('') } },
            !entries.length ? h('option', { value: '' }, '') : entries.map(model => h('option', { key: model.id, value: model.id }, model.label))),
          h('span', { role: 'status' }, !data ? '加载中' : !entries.length ? '未配置' : busy === kind ? '连接中' : checking ? '检查中' : connected ? '已连接' : '未连接'),
          entries.length && !connected && !checking ? h('button', { type: 'button', 'aria-label': `连接${label}`, disabled: !!busy, onClick: () => connect(kind) }, '连接') : null)
      }),
      data?.pending_llm ? h('p', { role: 'status' }, '聊天模型待重启生效') : null,
      error ? h('p', { role: 'alert' }, error) : null)
  }
  exports.ServerList = ServerList
})
