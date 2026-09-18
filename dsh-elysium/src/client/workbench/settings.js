// 职责：按类别固定列出私有与三方模型，并在对应模型右侧展示连接状态。
load('elysium/settings', (require, exports) => {
  const { createElement: h, useState, useEffect } = require('react')
  const { settingsRequest } = require('elysium/settings-api')
  const labels = { image: '图片模型', video: '视频模型' }
  const ownKey = id => `own:${id}`, thirdKey = id => `third:${id}`
  function Settings() {
    const [data, setData] = useState(null), [selected, setSelected] = useState({}), [thirdPartySelected, setThirdPartySelected] = useState({})
    const [origin, setOrigin] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(null), [status, setStatus] = useState({})
    useEffect(() => {
      const controller = new AbortController()
      settingsRequest('models', null, controller.signal).then(async value => {
        const nextSelected = { ...value.selected }, nextOrigin = { ...(value.origin || {}) }
        for (const kind of Object.keys(labels)) {
          if (nextOrigin[kind] === 'third') continue
          const id = nextSelected[kind] || value.models?.[kind]?.[0]?.id || ''
          if (id) { nextSelected[kind] = id; nextOrigin[kind] = 'own' }
        }
        setData(value); setSelected(nextSelected); setThirdPartySelected(value.third_party_selected || {}); setOrigin(nextOrigin)
        await connectPrivate({ ...value, selected: nextSelected }, controller.signal)
      }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      return () => controller.abort()
    }, [])
    function setModelStatus(key, value) { setStatus(current => ({ ...current, [key]: value })) }
    async function connectPrivate(value, signal) {
      let revision = value.revision
      if (value.chat_model) {
        const key = value.chat_model.id
        setBusy(key); setModelStatus(key, 'connecting')
        try { await settingsRequest('tunnel-connect', { id: key }, signal); if (!signal.aborted) setModelStatus(key, 'connected') }
        catch { if (!signal.aborted) setModelStatus(key, 'failed') }
      }
      for (const kind of Object.keys(labels)) {
        const id = value.selected?.[kind]
        if (!id) continue
        const key = ownKey(id)
        setBusy(key); setModelStatus(key, 'connecting')
        try {
          const probe = await settingsRequest('model-status', { kind, id }, signal)
          if (probe.connected) { if (!signal.aborted) setModelStatus(key, 'connected'); continue }
          const result = await settingsRequest('model-connect', { kind, id, revision }, signal)
          revision = result.revision ?? revision
          if (!signal.aborted) { setModelStatus(key, 'connected'); setData(current => current && ({ ...current, revision })) }
        } catch { if (!signal.aborted) setModelStatus(key, 'failed') }
      }
      if (!signal.aborted) setBusy(null)
    }
    async function connectChat() {
      if (busy || !data?.chat_model) return
      const key = data.chat_model.id
      setBusy(key); setModelStatus(key, 'connecting')
      try {
        await settingsRequest('tunnel-connect', { id: key })
        setModelStatus(key, 'connected')
      } catch { setModelStatus(key, 'failed') }
      finally { setBusy(null) }
    }
    async function ensureOwn(kind, id) {
      if (origin[kind] === 'own' && data.selected?.[kind] === id) {
        const probe = await settingsRequest('model-status', { kind, id })
        if (probe.connected) return null
      }
      return settingsRequest('model-connect', { kind, id, revision: data.revision })
    }
    async function connectOwn(kind, id = selected[kind]) {
      if (busy || !id) return
      const key = ownKey(id)
      setBusy(key); setModelStatus(key, 'connecting')
      try {
        const value = await ensureOwn(kind, id)
        setModelStatus(key, 'connected')
        setOrigin(current => ({ ...current, [kind]: 'own' }))
        if (value) setData(current => ({ ...current, revision: value.revision ?? current.revision, selected: { ...current.selected, [kind]: id } }))
      } catch { setModelStatus(key, 'failed') }
      finally { setBusy(null) }
    }
    async function chooseOwn(kind, id) {
      if (busy || !id) return
      const key = ownKey(id)
      setSelected(current => ({ ...current, [kind]: id }))
      setOrigin(current => ({ ...current, [kind]: 'own' }))
      setBusy(key); setModelStatus(key, 'connecting')
      try {
        const value = await ensureOwn(kind, id)
        setModelStatus(key, 'connected')
        setData(current => ({ ...current, revision: value?.revision ?? current.revision, selected: { ...current.selected, [kind]: id } }))
      } catch { setModelStatus(key, 'failed') }
      finally { setBusy(null) }
    }
    async function chooseThirdParty(kind, id) {
      if (busy || !id) return
      const key = thirdKey(id)
      setSelected(current => ({ ...current, [kind]: '' }))
      setThirdPartySelected(current => ({ ...current, [kind]: id }))
      setOrigin(current => ({ ...current, [kind]: 'third' }))
      setBusy(key); setModelStatus(key, 'connecting')
      try {
        const value = await settingsRequest('third-party-select', { kind, id, revision: data.revision })
        setModelStatus(key, 'connected')
        setData(current => ({ ...current, revision: value.revision, selected: { ...current.selected, [kind]: '' } }))
      } catch { setModelStatus(key, 'failed') }
      finally { setBusy(null) }
    }
    function choose(kind, value) {
      if (!value) return
      if (value === choice(kind)) {
        if (status[value] === 'failed' || (value.startsWith('own:') && status[value] !== 'connected' && status[value] !== 'connecting')) {
          if (kind === 'chat') return connectChat()
          if (value.startsWith('own:')) return connectOwn(kind, value.slice(4))
          if (value.startsWith('third:')) return chooseThirdParty(kind, value.slice(6))
        }
        return
      }
      if (value.startsWith('own:')) return chooseOwn(kind, value.slice(4))
      if (value.startsWith('third:')) return chooseThirdParty(kind, value.slice(6))
    }
    function statusControl(model, selectedRow, onConnect) {
      if (status[model.value] === 'connecting' || busy === model.value) return h('span', { role: 'status', 'data-state': 'connecting' }, '连接中')
      if (!selectedRow) return null
      if (status[model.value] === 'failed') return h('span', null,
        h('span', { role: 'status', 'data-state': 'failed' }, '连接失败'),
        ' ',
        h('button', { type: 'button', disabled: !!busy, onClick: onConnect }, '连接'))
      if (status[model.value] === 'connected') return h('span', { role: 'status', 'data-state': 'connected' }, '已连接')
      if (model.own) return h('button', { type: 'button', disabled: !!busy, onClick: onConnect }, '连接')
      return null
    }
    function options(kind) {
      return [
        ...(data?.models[kind] || []).map(model => ({ value: ownKey(model.id), label: `${model.label}（私有）`, own: true })),
        ...(data?.third_party?.[kind] || []).map(model => ({ value: thirdKey(model.id), label: `${model.label}（三方）`, own: false })),
      ]
    }
    function choice(kind) {
      if (selected[kind]) return ownKey(selected[kind])
      if (origin[kind] === 'third' && thirdPartySelected[kind]) return thirdKey(thirdPartySelected[kind])
      return ''
    }
    function modelList(kind, label, entries, current) {
      return h('section', { key: kind, className: 'elysium-model-group', 'aria-label': label },
        h('h3', null, `${label}：`),
        entries.length
          ? h('div', { role: 'radiogroup', 'aria-label': label }, entries.map(model => {
            const selectedRow = model.value === current
            return h('div', { key: model.value, className: `elysium-model-row${selectedRow ? ' elysium-model-row-active' : ''}` },
              h('button', { type: 'button', role: 'radio', 'aria-checked': selectedRow, 'aria-label': model.label, disabled: !!busy, onClick: () => choose(kind, model.value) }, model.label),
              statusControl(model, selectedRow, () => kind === 'chat' ? connectChat() : model.own ? connectOwn(kind, model.value.slice(4)) : chooseThirdParty(kind, model.value.slice(6))))
          }))
          : h('p', { className: 'elysium-compact-meta' }, '未配置'))
    }
    return h('section', { className: 'elysium-settings', 'aria-label': '模型设置' },
      h('h2', null, '大模型选择'),
      data?.chat_model ? modelList('chat', '聊天模型', [{ value: data.chat_model.id, label: `${data.chat_model.label}（私有）`, own: true }], data.chat_model.id) : null,
      Object.entries(labels).map(([kind, label]) => modelList(kind, label, options(kind), choice(kind))),
      error ? h('p', { role: 'alert' }, error) : null)
  }
  exports.Settings = Settings
})
