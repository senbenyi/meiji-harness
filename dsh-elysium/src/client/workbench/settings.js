// 职责：选择创作质量及私有、三方模型。
load('elysium/settings', (require, exports) => {
  const { createElement: h, useState, useEffect } = require('react')
  const { settingsRequest } = require('elysium/settings-api')
  const labels = { image: '图片模型', video: '视频模型' }
  const qualities = [['fast', '快速创作'], ['regular', '常规创作'], ['high', '高清创作']]
  function Settings() {
    const [data, setData] = useState(null), [selected, setSelected] = useState({}), [thirdPartySelected, setThirdPartySelected] = useState({})
    const [creation, setCreation] = useState(null)
    const [error, setError] = useState(''), [busy, setBusy] = useState(null)
    async function refresh(signal) {
      const value = await settingsRequest('models', null, signal)
      if (signal?.aborted) return
      setData(value); setSelected(value.selected); setThirdPartySelected(value.third_party_selected || {}); setCreation(value.creation)
    }
    useEffect(() => {
      const controller = new AbortController()
      refresh(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      return () => controller.abort()
    }, [])
    async function chooseQuality(quality) {
      if (busy || !creation) return
      const previous = creation
      setCreation({ ...creation, quality }); setBusy('quality'); setError('')
      try {
        const value = await settingsRequest('creation-quality', { quality, revision: creation.revision })
        setCreation({ revision: value.revision, quality: value.quality })
      } catch (failure) {
        setCreation(previous); setError(failure.message)
        if (failure.status === 409) await refresh().catch(error => setError(error.message))
      }
      finally { setBusy(null) }
    }
    async function chooseOwn(kind, id) {
      if (busy || !id || id === selected[kind]) return
      if (!data.available?.[kind]?.includes(id)) { setError('目标服务器未配置'); return }
      const previous = selected[kind]
      setSelected(current => ({ ...current, [kind]: id }))
      setBusy(kind); setError('')
      try {
        const value = await settingsRequest('model-select', { kind, id, revision: data.revision })
        setData(current => ({ ...current, revision: value.revision ?? current.revision, selected: { ...current.selected, [kind]: id } }))
      } catch (failure) {
        setSelected(current => ({ ...current, [kind]: previous }))
        setError(failure.message)
        if (failure.status === 409) await refresh().catch(error => setError(error.message))
      }
      finally { setBusy(null) }
    }
    async function chooseThirdParty(kind, id) {
      if (busy || !id) return
      setBusy(`third:${kind}`); setError('')
      try {
        const value = await settingsRequest('third-party-select', { kind, id, revision: data.revision })
        setThirdPartySelected(current => ({ ...current, [kind]: id }))
        setData(current => ({ ...current, revision: value.revision }))
      } catch (failure) {
        setError(failure.message)
        if (failure.status === 409) await refresh().catch(error => setError(error.message))
      }
      finally { setBusy(null) }
    }
    return h('section', { className: 'elysium-settings', 'aria-label': '模型设置' },
      h('h2', null, '创作设置'),
      h('div', { className: 'elysium-model-row' },
        h('label', { htmlFor: 'elysium-creation-quality' }, '创作质量：'),
        h('select', { id: 'elysium-creation-quality', 'aria-label': '创作质量', value: creation?.quality || 'regular', disabled: !!busy || !creation, onChange: event => chooseQuality(event.target.value) },
          qualities.map(([value, label]) => h('option', { key: value, value }, label)))),
      h('h2', null, '私有模型'),
      h('div', { className: 'elysium-model-row' },
        h('label', { htmlFor: 'elysium-model-chat' }, '聊天模型：'),
        h('select', { id: 'elysium-model-chat', 'aria-label': '聊天模型', value: data?.chat_model?.id || '', disabled: true },
          h('option', { value: data?.chat_model?.id || '' }, data?.chat_model?.label || '未配置'))),
      Object.entries(labels).map(([kind, label]) => {
        const entries = data?.models[kind] || [], id = selected[kind] || ''
        const available = data?.available?.[kind]?.includes(id)
        return h('div', { key: kind, className: 'elysium-model-row' },
          h('label', { htmlFor: `elysium-model-${kind}` }, `${label}：`),
          h('select', { id: `elysium-model-${kind}`, 'aria-label': label, value: id, disabled: !!busy || !entries.length, onChange: event => chooseOwn(kind, event.target.value) },
            !entries.length ? h('option', { value: '' }, '未配置') : [!id ? h('option', { key: 'choose', value: '' }, '请选择模型') : null,
              ...entries.map(model => h('option', { key: model.id, value: model.id }, model.label))]),
          id && !available ? h('span', { className: 'elysium-connection-error' }, '目标服务器未配置') : null)
      }),
      data?.third_party ? h('section', { 'aria-label': '三方模型' }, h('h2', null, '三方模型'),
        ['image', 'video'].map(kind => {
          const entries = data.third_party?.[kind] || [], label = `三方${labels[kind]}`
          return h('div', { key: kind, className: 'elysium-model-row' },
            h('label', { htmlFor: `elysium-third-party-${kind}` }, `${labels[kind]}：`),
            h('select', { id: `elysium-third-party-${kind}`, 'aria-label': label, value: thirdPartySelected[kind] || '', disabled: !!busy || !entries.length, onChange: event => chooseThirdParty(kind, event.target.value) },
              !entries.length ? h('option', { value: '' }, '未配置') : entries.map(model => h('option', { key: model.id, value: model.id }, model.label))))
        })) : null,
      error ? h('p', { role: 'alert' }, error) : null)
  }
  exports.Settings = Settings
})
