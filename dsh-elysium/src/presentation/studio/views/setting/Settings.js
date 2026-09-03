import './settings.css'

export function createComfyUiSettings(React, api) {
  const { createElement: h, useCallback, useEffect, useState } = React

  return function ComfyUiSettings() {
    const [state, setState] = useState(null)
    const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8189')
    const [templateNotes, setTemplateNotes] = useState({})
    const [loras, setLoras] = useState([])
    const [filter, setFilter] = useState('')
    const [pick, setPick] = useState('')
    const [workflow, setWorkflow] = useState({ path: '', id: '', title: '' })
    const [draft, setDraft] = useState(null)
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState(null)

    const apply = value => {
      setState(value)
      setBaseUrl(value.baseUrl || 'http://127.0.0.1:8189')
      setLoras((value.loras || []).map(item => ({ ...item })))
      setTemplateNotes(Object.fromEntries((value.templates || []).map(item => [item.id, item.user_note || ''])))
    }
    const request = async (route, body, message) => {
      setBusy(true)
      setNotice(null)
      try {
        const value = await api.fetchJson(route, body)
        apply(value)
        if (message) setNotice({ ok: true, text: message })
        return value
      } catch (error) {
        setNotice({ ok: false, text: error.message || String(error) })
        return null
      } finally {
        setBusy(false)
      }
    }
    const refresh = useCallback(() => { void request('/comfyui.state', {}) }, [])
    useEffect(refresh, [refresh])

    const payload = nextLoras => ({
      baseUrl,
      templates: Object.fromEntries(Object.entries(templateNotes).map(([id, note]) => [id, { note }])),
      loras: Object.fromEntries((nextLoras || loras).map(item => [item.name, {
        triggerWords: item.triggerWords || '',
        mode: item.mode === 'model-only' ? 'model-only' : 'both',
        note: item.note || '',
      }])),
    })
    const save = (message, nextLoras) => request('/comfyui.save', payload(nextLoras), message)
    const scan = async () => {
      setBusy(true)
      setNotice(null)
      try {
        const value = await api.fetchJson('/comfyui.scan', workflow)
        setDraft(value.draft)
        setWorkflow(current => ({ ...current, id: value.draft?.id || current.id, title: value.draft?.title || current.title }))
        setNotice({ ok: true, text: '扫描完成，确认后导入。' })
      } catch (error) {
        setNotice({ ok: false, text: error.message || String(error) })
      } finally {
        setBusy(false)
      }
    }

    const connected = state?.ping?.ok
    const device = /RTX\s*\d+/i.exec(state?.ping?.device || '')?.[0] || 'ComfyUI'
    const registered = new Set(loras.map(item => item.name))
    const query = filter.trim().toLowerCase()
    const choices = (state?.availableLoras || []).filter(name => !registered.has(name) && (!query || name.toLowerCase().includes(query)))
    const selected = choices.includes(pick) ? pick : (choices[0] || '')

    return h('div', { className: 'tf-comfy' },
      h('header', { className: 'tf-settings-head' },
        h('div', null, h('div', { className: 'tf-title' }, '自定义'), h('div', { className: 'tf-card-meta' }, '连接、工作流与 LoRA')),
        h('span', { className: `tf-comfy-status ${connected ? 'is-online' : 'is-offline'}` }, connected ? `在线 · ${device}` : '未连接'),
      ),
      notice ? h('div', { className: notice.ok ? 'tf-success' : 'tf-error' }, notice.text) : null,

      h('section', { className: 'tf-settings-card' },
        h('span', { className: 'tf-settings-label' }, 'ComfyUI'),
        h('div', { className: 'tf-settings-line' },
          h('input', { className: 'tf-input', 'aria-label': 'ComfyUI 地址', value: baseUrl, onChange: event => setBaseUrl(event.target.value) }),
          h('button', { className: 'tf-btn', disabled: busy, onClick: () => save('连接测试完成。') }, '测试'),
          h('button', { className: 'tf-icon-btn', 'aria-label': '刷新状态', title: '刷新状态', disabled: busy, onClick: refresh }, '↻'),
        ),
      ),

      h('details', { className: 'tf-settings-section' },
        h('summary', { className: 'tf-settings-summary' }, h('span', null, '工作流'), h('span', { className: 'tf-settings-count' }, `${state?.templates?.length || 0} 个`)),
        h('div', { className: 'tf-settings-body' },
          (state?.templates || []).map(template => h('details', { className: 'tf-settings-item', key: template.id },
            h('summary', null,
              h('span', { className: 'tf-comfy-name' }, template.title || template.id),
              h('span', { className: 'tf-settings-meta' }, (template.capabilities?.mode || []).join(' · ')),
            ),
            h('div', { className: 'tf-settings-item-body' },
              h('div', { className: 'tf-card-meta' }, template.id),
              template.prompt_hint ? h('p', { className: 'tf-settings-hint' }, template.prompt_hint) : null,
              h('textarea', {
                className: 'tf-textarea tf-comfy-note', 'aria-label': `${template.id} AI 注释`,
                value: templateNotes[template.id] || '', placeholder: '给 AI 的底模、提示词格式和限制说明',
                onChange: event => setTemplateNotes({ ...templateNotes, [template.id]: event.target.value }),
              }),
              h('button', { className: 'tf-link-danger', disabled: busy, onClick: () => request('/comfyui.remove_template', { id: template.id }, `已删除 ${template.id}`) }, '删除工作流'),
            ),
          )),
          h('div', { className: 'tf-settings-footer' }, h('button', { className: 'tf-btn', disabled: busy, onClick: () => save('工作流注释已保存。') }, '保存注释')),
        ),
      ),

      h('details', { className: 'tf-settings-section' },
        h('summary', { className: 'tf-settings-summary' }, h('span', null, '导入工作流'), h('span', { className: 'tf-settings-count' }, 'API JSON')),
        h('div', { className: 'tf-settings-body' },
          h('p', { className: 'tf-settings-hint' }, '在 ComfyUI 开启开发模式，保存 API Format JSON。扫描不会执行模型。'),
          h('div', { className: 'tf-settings-stack' },
            h('input', { className: 'tf-input', placeholder: 'API Format JSON 绝对路径', value: workflow.path, onChange: event => setWorkflow({ ...workflow, path: event.target.value }) }),
            h('div', { className: 'tf-settings-line' },
              h('input', { className: 'tf-input', placeholder: '模板 ID（可留空）', value: workflow.id, onChange: event => setWorkflow({ ...workflow, id: event.target.value }) }),
              h('input', { className: 'tf-input', placeholder: '显示名称（可留空）', value: workflow.title, onChange: event => setWorkflow({ ...workflow, title: event.target.value }) }),
            ),
          ),
          h('div', { className: 'tf-settings-footer' },
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy || !workflow.path.trim(), onClick: scan }, '扫描'),
            h('button', { className: 'tf-btn', disabled: busy || !workflow.path.trim() || !draft, onClick: () => request('/comfyui.import', workflow, `已导入 ${workflow.id || '工作流'}`) }, '导入'),
          ),
          draft ? h('pre', { className: 'tf-comfy-pre' }, JSON.stringify(draft, null, 2)) : null,
        ),
      ),

      h('details', { className: 'tf-settings-section' },
        h('summary', { className: 'tf-settings-summary' }, h('span', null, 'LoRA'), h('span', { className: 'tf-settings-count' }, `${loras.length} 个已配置 · ${state?.availableLoras?.length || 0} 个远程`)),
        h('div', { className: 'tf-settings-body' },
          loras.map((item, index) => h('details', { className: 'tf-settings-item', key: item.name },
            h('summary', null,
              h('span', { className: 'tf-comfy-name' }, item.name),
              h('span', { className: `tf-settings-dot ${item.on_server === false ? 'is-missing' : ''}` }),
            ),
            h('div', { className: 'tf-settings-item-body tf-settings-stack' },
              item.usedBy?.length ? h('div', { className: 'tf-card-meta' }, `用于 ${item.usedBy.join(', ')}`) : null,
              item.on_server === false ? h('div', { className: 'tf-comfy-missing' }, '远程不存在') : null,
              h('input', { className: 'tf-input', 'aria-label': `${item.name} 触发词`, value: item.triggerWords || '', placeholder: '触发词', onChange: event => setLoras(current => current.map((value, i) => i === index ? { ...value, triggerWords: event.target.value } : value)) }),
              h('select', { className: 'tf-input', 'aria-label': `${item.name} 用法`, value: item.mode, onChange: event => setLoras(current => current.map((value, i) => i === index ? { ...value, mode: event.target.value } : value)) },
                h('option', { value: 'both' }, '写入提示词 + 模型'), h('option', { value: 'model-only' }, '仅模型')),
              h('textarea', { className: 'tf-textarea tf-comfy-note', 'aria-label': `${item.name} AI 注释`, value: item.note || '', placeholder: '给 AI 的用法、建议权重和适用模板', onChange: event => setLoras(current => current.map((value, i) => i === index ? { ...value, note: event.target.value } : value)) }),
              h('button', { className: 'tf-link-danger', disabled: busy, onClick: () => request('/comfyui.remove_lora', { name: item.name }, `已移除 ${item.name}`) }, '删除 LoRA'),
            ),
          )),
          h('div', { className: 'tf-comfy-add' },
            h('div', { className: 'tf-settings-line' },
              h('input', { className: 'tf-input tf-comfy-filter', value: filter, placeholder: connected ? '筛选远程 LoRA' : 'LoRA 文件名.safetensors', onChange: event => setFilter(event.target.value) }),
              connected ? h('select', { className: 'tf-input tf-comfy-picker', value: selected, disabled: !choices.length, onChange: event => setPick(event.target.value) }, choices.length ? choices.slice(0, 400).map(name => h('option', { key: name, value: name }, name)) : h('option', { value: '' }, '没有可添加项')) : null,
              h('button', {
                className: 'tf-btn tf-btn-ghost', disabled: busy || !(connected ? selected : filter.trim()),
                onClick: () => {
                  const name = connected ? selected : filter.trim()
                  if (!name || registered.has(name)) return
                  const next = [...loras, { name, triggerWords: '', mode: 'both', note: '', usedBy: [], on_server: connected }]
                  setLoras(next)
                  void save(`已添加 ${name}`, next)
                  setPick('')
                  if (!connected) setFilter('')
                },
              }, '添加'),
            ),
          ),
          h('div', { className: 'tf-settings-footer' }, h('button', { className: 'tf-btn', disabled: busy, onClick: () => save('LoRA 设置已保存。') }, '保存 LoRA')),
        ),
      ),
    )
  }
}
