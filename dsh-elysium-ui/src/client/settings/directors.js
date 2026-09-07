// Harness 浏览器模块格式；React 由宿主提供，无需打包旧插件。
window.__ModuleLoader__.load({
  id: 'elysium-ui/settings',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useState, useSyncExternalStore } = React

    function DirectorEditor({ scope, snapshot }) {
      const [directors, setDirectors] = useState(() => structuredClone(snapshot.value.directors))
      const [revision, setRevision] = useState(snapshot.revision)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const writable = snapshot.writable && snapshot.status === 'ready'
      const update = (id, field, value) => {
        setMessage('')
        setDirectors(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row))
      }
      const save = async (event) => {
        event.preventDefault()
        if (!writable || busy) return
        if (directors.some(row => !row.name.trim() || !row.prompt.trim())) {
          setMessage('导演名称和提示词不能为空')
          return
        }
        setBusy(true)
        setMessage('')
        try {
          await scope.mutate([{ op: 'set', path: ['directors'], value: directors }], revision)
          setRevision(scope.getSnapshot().revision)
          setMessage('已保存')
        } catch (error) {
          setMessage(`保存失败：${error.message}。如其他页面修改了设置，请重新加载后编辑。`)
        } finally { setBusy(false) }
      }
      return h('form', { onSubmit: save },
        h('h3', null, '导演设置'),
        h('p', null, '短视频直接生成，无需导演。创作长视频或连续剧时，可说“使用××导演”。保存不会生成，修改用于后续创作。'),
        h('fieldset', { disabled: busy || !writable, style: { border: 0, padding: 0 } },
          directors.length ? null : h('p', null, '暂无导演'),
          ...directors.map(row => h('fieldset', { key: row.id, style: { marginBottom: 16 } },
            h('legend', null, row.name || '新导演'),
            h('label', { style: { display: 'block' } }, '名称',
              h('input', { value: row.name, required: true, onChange: e => update(row.id, 'name', e.target.value) })),
            h('label', { style: { display: 'block', marginTop: 8 } }, '提示词',
              h('textarea', { value: row.prompt, rows: 6, required: true,
                style: { display: 'block', width: '100%', boxSizing: 'border-box' },
                onChange: e => update(row.id, 'prompt', e.target.value) })),
            h('button', { type: 'button', onClick: () => {
              setDirectors(rows => rows.filter(item => item.id !== row.id)); setMessage('')
            } }, '删除'))),
          h('button', { type: 'button', onClick: () => {
            setDirectors(rows => [...rows, { id: crypto.randomUUID(), name: '', prompt: '' }]); setMessage('')
          } }, '新增导演'),
          ' ', h('button', { type: 'submit' }, busy ? '保存中…' : '保存'),
          ' ', h('button', { type: 'button', onClick: () => {
            const current = scope.getSnapshot()
            setDirectors(structuredClone(current.value.directors))
            setRevision(current.revision); setMessage('已重新加载')
          } }, '重新加载')),
        h('p', { role: 'status' }, message))
    }

    function SettingsPage({ scope }) {
      const snapshot = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      if (snapshot.status === 'loading') return h('p', null, '正在读取导演设置…')
      if (snapshot.status !== 'ready' || !snapshot.value) return h('p', { role: 'alert' }, '导演设置不可用')
      return h('section', { style: { maxWidth: 760, padding: 16 } },
        h('h2', null, '极乐世界'),
        h('label', null, h('input', { type: 'checkbox', checked: snapshot.value.enabled,
          disabled: busy || !snapshot.writable,
          onChange: async e => {
            setBusy(true); setError('')
            try { await scope.set('enabled', e.target.checked) }
            catch (err) { setError(`保存失败：${err.message}`) }
            finally { setBusy(false) }
          } }), '启用导演管理'),
        error ? h('p', { role: 'alert' }, error) : null,
        snapshot.writable ? null : h('p', null, '当前设置只读'),
        snapshot.value.enabled ? h(DirectorEditor, { scope, snapshot }) : null)
    }

    return {
      inject: ['slots', 'settingsScope'],
      apply(ctx) {
        const scope = ctx.settingsScope.bind({ namespace: 'dsh-elysium-ui' })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'elysium-ui', label: () => '极乐世界',
          order: 100, inject: () => ({ scope }),
        }, SettingsPage))
      },
    }
  },
})
