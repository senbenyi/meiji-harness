// 职责：按模型类别提供简洁的私有与三方模型选择。
load('elysium/servers', (require, exports) => {
  const { createElement: h, useState, useEffect } = require('react')
  const { serverRequest } = require('elysium/server-api')
  const labels = { image: '图片模型', video: '视频模型' }
  function ServerList() {
    const [data, setData] = useState(null), [selected, setSelected] = useState({}), [thirdPartySelected, setThirdPartySelected] = useState({})
    const [error, setError] = useState(''), [busy, setBusy] = useState(null), [chatConnected, setChatConnected] = useState(false)
    useEffect(() => {
      const controller = new AbortController()
      serverRequest('models', null, controller.signal).then(value => {
        setData(value); setSelected(value.selected); setThirdPartySelected(value.third_party_selected || {})
      }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      return () => controller.abort()
    }, [])
    async function connectChat() {
      if (busy || !data?.chat_model) return
      setBusy('chat'); setError('')
      try {
        const value = await serverRequest('tunnel-connect', { id: data.chat_model.id })
        setChatConnected(value.connected === true)
      } catch (error) { setError(error.message) }
      finally { setBusy(null) }
    }
    async function chooseOwn(kind, id) {
      if (busy || !id) return
      setSelected(current => ({ ...current, [kind]: id }))
      setBusy(kind); setError('')
      try {
        const value = await serverRequest('model-connect', { kind, id, revision: data.revision })
        setData(current => ({ ...current, revision: value.revision ?? current.revision, selected: { ...current.selected, [kind]: id } }))
      } catch (error) { setSelected(current => ({ ...current, [kind]: data.selected[kind] || '' })); setError(error.message) }
      finally { setBusy(null) }
    }
    async function chooseThirdParty(kind, id) {
      if (busy || !id) return
      setBusy(`third:${kind}`); setError('')
      try {
        const value = await serverRequest('third-party-select', { kind, id, revision: data.revision })
        setThirdPartySelected(current => ({ ...current, [kind]: id }))
        setData(current => ({ ...current, revision: value.revision }))
      } catch (error) { setError(error.message) }
      finally { setBusy(null) }
    }
    return h('section', { className: 'elysium-server-list', 'aria-label': '模型设置' },
      h('h2', null, '私有模型'),
      data?.chat_model ? h('div', { className: 'elysium-model-row' },
        h('label', { htmlFor: 'elysium-model-chat' }, '聊天模型：'),
        h('select', { id: 'elysium-model-chat', 'aria-label': '聊天模型', value: data.chat_model.id, disabled: busy === 'chat' },
          h('option', { value: data.chat_model.id }, data.chat_model.label)),
        h('button', { type: 'button', disabled: busy === 'chat', onClick: connectChat }, busy === 'chat' ? '连接中…' : chatConnected ? '重新连接' : '连接')) : null,
      Object.entries(labels).map(([kind, label]) => {
        const entries = data?.models[kind] || [], id = selected[kind] || ''
        return h('div', { key: kind, className: 'elysium-model-row' },
          h('label', { htmlFor: `elysium-model-${kind}` }, `${label}：`),
          h('select', { id: `elysium-model-${kind}`, 'aria-label': label, value: id, disabled: busy === kind || !entries.length, onChange: event => chooseOwn(kind, event.target.value) },
            !entries.length ? h('option', { value: '' }, '未配置') : entries.map(model => h('option', { key: model.id, value: model.id }, model.label))))
      }),
      data?.third_party ? h('section', { 'aria-label': '三方模型' }, h('h2', null, '三方模型'),
        ['image', 'video'].map(kind => {
          const entries = data.third_party?.[kind] || [], label = `三方${labels[kind]}`
          return h('div', { key: kind, className: 'elysium-model-row' },
            h('label', { htmlFor: `elysium-third-party-${kind}` }, `${labels[kind]}：`),
            h('select', { id: `elysium-third-party-${kind}`, 'aria-label': label, value: thirdPartySelected[kind] || '', disabled: busy === `third:${kind}` || !entries.length, onChange: event => chooseThirdParty(kind, event.target.value) },
              !entries.length ? h('option', { value: '' }, '未配置') : entries.map(model => h('option', { key: model.id, value: model.id }, model.label))))
        })) : null,
      error ? h('p', { role: 'alert' }, error) : null)
  }
  exports.ServerList = ServerList
})
