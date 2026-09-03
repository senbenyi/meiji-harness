import { createConfirmDialog } from '../../components/Modal.js'

function templatePayload(notes) {
  return Object.fromEntries(Object.entries(notes).map(([id, note]) => [id, { note }]))
}

function loraPayload(items) {
  return Object.fromEntries(items
    .filter(item => item.in_registry !== false)
    .map(item => [item.name, {
      triggerWords: item.triggerWords || '',
      mode: item.mode === 'model-only' ? 'model-only' : 'both',
      note: item.note || '',
    }]))
}

function notesFromState(value) {
  return Object.fromEntries((value?.templates || []).map(item => [item.id, item.user_note || '']))
}

function routingFromState(value) {
  const saved = value?.modelRouting || {}
  return {
    planner: {
      provider: saved.planner?.provider || 'qwen38-local',
      model: saved.planner?.model || 'qwen3.8-27b-video-prompt',
      maxTokens: Number(saved.planner?.maxTokens || 4096),
    },
    stages: {
      characterImage: saved.stages?.characterImage || 'qwen-image-t2i',
      startFrame: saved.stages?.startFrame || 'qwen-image-t2i',
      keyframeImage: saved.stages?.keyframeImage || 'qwen-image-edit',
      chapterVideo: saved.stages?.chapterVideo || 'wan22-remix-long',
      shotImage: saved.stages?.shotImage || 'qwen-image-t2i',
      shotVideo: saved.stages?.shotVideo || 'wan22-remix-long',
    },
  }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function workflowFingerprint(value) {
  return JSON.stringify({ path: value.path.trim(), id: value.id.trim(), title: value.title.trim() })
}

function workflowErrorText(error) {
  if (error.message) return error.message
  if (error.code === 'NODE_MISSING') return `缺少节点：${error.class_type}`
  if (error.code === 'MODEL_MISSING') return `缺少模型：${error.name}`
  if (error.code === 'NODE_SCHEMA_MISMATCH') return `节点 ${error.node} 缺少输入 ${error.missing_input}`
  return error.code || '未知错误'
}

export function createComfyUiSettings(React, api) {
  const { createElement: h, useEffect, useRef, useState } = React
  const ConfirmDialog = createConfirmDialog(React)

  function Field({ label, hint, children, composite = false }) {
    return h(composite ? 'div' : 'label', { className: 'tf-settings-field' },
      h('span', { className: 'tf-settings-label' }, label),
      children,
      hint ? h('small', null, hint) : null,
    )
  }

  return function ComfyUiSettings({ onDirty }) {
    const [state, setState] = useState(null)
    const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8189')
    const [modelRouting, setModelRouting] = useState(() => routingFromState(null))
    const [templateNotes, setTemplateNotes] = useState({})
    const [loras, setLoras] = useState([])
    const [filter, setFilter] = useState('')
    const [pick, setPick] = useState('')
    const [workflow, setWorkflow] = useState({ path: '', id: '', title: '' })
    const [draft, setDraft] = useState(null)
    const [tested, setTested] = useState(null)
    const [busy, setBusy] = useState({})
    const [notice, setNotice] = useState(null)
    const [pendingDelete, setPendingDelete] = useState(null)
    const [workflowTests, setWorkflowTests] = useState({})
    const [testingWorkflows, setTestingWorkflows] = useState({})
    const [openWorkflows, setOpenWorkflows] = useState({})
    const busyRef = useRef(new Set())
    const testingWorkflowsRef = useRef(new Set())

    const applyState = (value, sections = ['base', 'models', 'templates', 'loras']) => {
      setState(value)
      if (sections.includes('base')) setBaseUrl(value.baseUrl || 'http://127.0.0.1:8189')
      if (sections.includes('models')) setModelRouting(routingFromState(value))
      if (sections.includes('templates')) setTemplateNotes(notesFromState(value))
      if (sections.includes('loras')) setLoras((value.loras || []).map(item => ({ ...item })))
    }

    const run = async (key, action) => {
      if (busyRef.current.has(key)) return null
      busyRef.current.add(key)
      setBusy(current => ({ ...current, [key]: true }))
      setNotice(null)
      try { return await action() }
      catch (error) {
        setNotice({ ok: false, text: error.message || String(error) })
        return null
      } finally {
        busyRef.current.delete(key)
        setBusy(current => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    }

    const loadState = async (initial = false) => {
      const load = async () => {
        const value = await api.fetchJson('/comfyui.state', {})
        applyState(value)
        setTested(null)
        setWorkflowTests({})
        if (!initial) setNotice({ ok: true, text: '状态已刷新。' })
        return value
      }
      if (!initial) return run('refresh', load)
      try { return await load() }
      catch (error) {
        setNotice({ ok: false, text: error.message || String(error) })
        return null
      }
    }

    useEffect(() => { void loadState(true) }, [])

    const currentTemplatePayload = templatePayload(templateNotes)
    const savedTemplatePayload = templatePayload(notesFromState(state))
    const currentLoraPayload = loraPayload(loras)
    const savedLoraPayload = loraPayload(state?.loras || [])
    const baseDirty = !!state && baseUrl.trim().replace(/\/$/, '') !== state.baseUrl
    const templatesDirty = !!state && !sameValue(currentTemplatePayload, savedTemplatePayload)
    const lorasDirty = !!state && !sameValue(currentLoraPayload, savedLoraPayload)
    const modelsDirty = !!state && !sameValue(modelRouting, routingFromState(state))
    const dirty = baseDirty || modelsDirty || templatesDirty || lorasDirty

    useEffect(() => { onDirty?.(dirty) }, [dirty, onDirty])
    useEffect(() => {
      if (!dirty) return undefined
      const warn = event => { event.preventDefault(); event.returnValue = '' }
      window.addEventListener('beforeunload', warn)
      return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    const testConnection = () => run('test', async () => {
      setTested(null)
      const value = await api.fetchJson('/comfyui.test', { baseUrl: baseUrl.trim() })
      setTested(value)
      setNotice({ ok: true, text: `连接成功${value.ping?.device ? ` · ${value.ping.device}` : ''}。${baseDirty ? '地址尚未保存。' : '当前保存地址未改变。'}` })
    })

    const saveBaseUrl = () => run('save-base', async () => {
      const value = await api.fetchJson('/comfyui.save', { baseUrl: baseUrl.trim() })
      applyState(value, ['base'])
      setTested(null)
      setWorkflowTests({})
      setNotice(value.ping?.ok
        ? { ok: true, text: 'ComfyUI 地址已保存并连接成功。' }
        : { ok: false, text: `地址已保存，但连接失败：${value.ping?.message || value.ping?.code || '无法访问服务'}` })
    })

    const saveModelRouting = () => run('save-models', async () => {
      const value = await api.fetchJson('/comfyui.save', { modelRouting })
      applyState(value, ['models'])
      setNotice({ ok: true, text: '模型路由已保存，后续任务将使用新的模型配置。' })
    })

    const saveTemplateNotes = () => run('save-templates', async () => {
      const value = await api.fetchJson('/comfyui.save', { templates: currentTemplatePayload })
      applyState(value, ['templates'])
      setNotice({ ok: true, text: '工作流注释已保存。' })
    })

    const saveLoras = () => run('save-loras', async () => {
      const value = await api.fetchJson('/comfyui.save', { loras: currentLoraPayload })
      applyState(value, ['loras'])
      setNotice({ ok: true, text: 'LoRA 设置已保存。' })
    })

    const scan = () => run('scan', async () => {
      const value = await api.fetchJson('/comfyui.scan', workflow)
      const next = { ...workflow, id: value.draft?.id || workflow.id, title: value.draft?.title || workflow.title }
      setWorkflow(next)
      setDraft({ preview: value.draft, fingerprint: workflowFingerprint(next) })
      setNotice({ ok: true, text: '扫描完成。请核对摘要后再导入。' })
    })

    const importWorkflow = () => run('import', async () => {
      const value = await api.fetchJson('/comfyui.import', workflow)
      applyState(value, ['templates'])
      setWorkflow({ path: '', id: '', title: '' })
      setDraft(null)
      setNotice({ ok: true, text: `已导入 ${value.id || '工作流'}。` })
    })

    const testWorkflow = async template => {
      const id = template.id
      if (testingWorkflowsRef.current.has(id)) return null
      testingWorkflowsRef.current.add(id)
      setTestingWorkflows(current => ({ ...current, [id]: true }))
      setWorkflowTests(current => ({ ...current, [id]: null }))
      try {
        const value = await api.fetchJson('/comfyui.test_template', { template: id })
        setWorkflowTests(current => ({ ...current, [id]: value }))
        return value
      } catch (error) {
        setWorkflowTests(current => ({ ...current, [id]: { ready: false, checked_nodes: 0, errors: [{ message: error.message || String(error) }] } }))
        return null
      } finally {
        testingWorkflowsRef.current.delete(id)
        setTestingWorkflows(current => {
          const next = { ...current }
          delete next[id]
          return next
        })
      }
    }

    const confirmDelete = () => run('delete', async () => {
      const target = pendingDelete
      if (!target) return
      if (target.type === 'template') {
        const value = await api.fetchJson('/comfyui.remove_template', { id: target.item.id })
        setState(value)
        setTemplateNotes(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== target.item.id)))
        setWorkflowTests(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== target.item.id)))
        setNotice({ ok: true, text: `已删除 ${target.item.title || target.item.id}。` })
      } else {
        const value = await api.fetchJson('/comfyui.remove_lora', { name: target.item.name })
        setState(value)
        setLoras(current => {
          const remaining = current.filter(item => item.name !== target.item.name)
          const referenced = value.loras?.find(item => item.name === target.item.name)
          return referenced ? [...remaining, { ...referenced }].sort((a, b) => a.name.localeCompare(b.name)) : remaining
        })
        setNotice({ ok: true, text: `已移除 ${target.item.name} 的自定义配置。` })
      }
      setPendingDelete(null)
    })

    const updateLora = (index, patch) => setLoras(current => current.map((item, i) => i === index ? { ...item, ...patch, in_registry: true } : item))
    const removeLora = item => {
      const saved = state?.loras?.find(value => value.name === item.name)
      if (!saved?.in_registry) {
        setLoras(current => current.map(value => value.name === item.name && saved ? { ...saved } : value).filter(value => value.name !== item.name || saved))
        return
      }
      setPendingDelete({ type: 'lora', item })
    }

    const testedCurrent = tested?.baseUrl === baseUrl.trim().replace(/\/$/, '')
    const connected = !baseDirty && state?.ping?.ok
    const deviceName = (testedCurrent ? tested?.ping?.device : state?.ping?.device) || ''
    const deviceLabel = deviceName.match(/(?:RTX|A\d|H\d|L\d)\s*\d+[A-Za-z]*/i)?.[0] || deviceName.replace(/^NVIDIA\s+(?:GeForce\s+)?/i, '')
    const statusText = !state ? '检查中…'
      : testedCurrent ? `在线${deviceLabel ? ` · ${deviceLabel}` : ''}${baseDirty ? ' · 未保存' : ''}`
        : baseDirty ? '地址未保存'
        : connected ? `在线${deviceLabel ? ` · ${deviceLabel}` : ''}`
          : `未连接${state.ping?.code ? ` · ${state.ping.code}` : ''}`
    const statusTone = !state ? 'is-pending' : testedCurrent ? 'is-online' : baseDirty ? 'is-pending' : connected ? 'is-online' : 'is-offline'
    const registered = new Set(loras.map(item => item.name))
    const query = filter.trim().toLowerCase()
    const choices = (state?.availableLoras || []).filter(name => !registered.has(name) && (!query || name.toLowerCase().includes(query)))
    const selected = choices.includes(pick) ? pick : (choices[0] || '')
    const draftCurrent = !!draft && draft.fingerprint === workflowFingerprint(workflow)
    const configuredCount = loras.filter(item => item.in_registry !== false).length
    const isBusy = key => !!busy[key]
    const textProviders = state?.textProviders || []
    const activeProvider = textProviders.find(item => item.id === modelRouting.planner.provider)
    const textModels = activeProvider?.models || []
    const templates = state?.templates || []
    const templateModes = template => template.capabilities?.mode || []
    const stageTemplates = key => templates.filter(template => {
      const modes = templateModes(template)
      if (key === 'keyframeImage') return modes.some(mode => ['i2i', 'keyframe', 'image'].includes(mode))
      if (key === 'chapterVideo') return modes.some(mode => ['long_video', 'six_anchor', 'video'].includes(mode))
      if (key === 'shotVideo') return modes.some(mode => ['i2v', 'long_video', 'video'].includes(mode))
      return modes.some(mode => ['t2i', 'image'].includes(mode))
    })
    const updatePlanner = patch => setModelRouting(current => ({ ...current, planner: { ...current.planner, ...patch } }))
    const updateStage = (key, template) => setModelRouting(current => ({ ...current, stages: { ...current.stages, [key]: template } }))

    const ModelSelect = ({ stage, label }) => {
      const choices = stageTemplates(stage)
      const current = modelRouting.stages[stage]
      return h(Field, { label }, h('select', { className: 'tf-input', value: current, disabled: isBusy('save-models'), onChange: event => updateStage(stage, event.target.value) },
        !choices.some(item => item.id === current) ? h('option', { value: current }, `${current}（当前配置）`) : null,
        choices.map(item => h('option', { key: item.id, value: item.id }, item.title || item.id)),
      ))
    }

    return h('div', { className: 'tf-comfy' },
      h('header', { className: 'tf-settings-head' },
        h('div', null, h('div', { className: 'tf-title' }, '模型设置')),
        h('span', { className: `tf-comfy-status ${statusTone}`, role: 'status', 'aria-live': 'polite', title: deviceName || statusText }, statusText),
      ),
      notice ? h('div', { className: notice.ok ? 'tf-success' : 'tf-error', role: notice.ok ? 'status' : 'alert', 'aria-live': 'polite' }, notice.text) : null,

      h('section', { className: 'tf-settings-card' },
        h(Field, { composite: true, label: 'ComfyUI 服务地址', hint: !baseDirty && state?.ping?.ok ? `已连接${state.ping.version ? ` · ComfyUI ${state.ping.version}` : ''}` : null },
          h('div', { className: 'tf-settings-line' },
            h('input', { className: 'tf-input', 'aria-label': 'ComfyUI 服务地址', value: baseUrl, inputMode: 'url', disabled: isBusy('save-base'), onChange: event => { setBaseUrl(event.target.value); setTested(null) } }),
            h('button', { className: 'tf-btn', disabled: isBusy('save-base') || !baseDirty, onClick: saveBaseUrl }, isBusy('save-base') ? '保存中…' : '保存地址'),
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: isBusy('test') || !baseUrl.trim(), onClick: testConnection }, isBusy('test') ? '测试中…' : '测试连接'),
            h('button', { className: 'tf-icon-btn', 'aria-label': '刷新服务器状态', title: dirty ? '请先保存或撤销未保存修改' : '刷新服务器状态', disabled: isBusy('refresh') || dirty, onClick: () => loadState(false) }, '↻'),
          ),
        ),
      ),

      h('details', { className: 'tf-settings-section tf-model-routing', open: true },
        h('summary', { className: 'tf-settings-summary' }, h('span', null, '模型路由'), h('span', { className: 'tf-settings-count' }, `文本、图片、视频${modelsDirty ? ' · 未保存' : ''}`)),
        h('div', { className: 'tf-settings-body tf-model-routing-body' },
          h('div', { className: 'tf-model-group' },
            h('div', { className: 'tf-model-group-title' }, '文本规划模型'),
            h('div', { className: 'tf-model-grid' },
              h(Field, { label: '供应商', hint: textProviders.length ? '来自 DSH 当前已注册的模型供应商。' : '当前未发现供应商，可保留已有自定义路由。' }, h('select', {
                className: 'tf-input', value: modelRouting.planner.provider, disabled: isBusy('save-models') || !textProviders.length,
                onChange: event => {
                  const provider = textProviders.find(item => item.id === event.target.value)
                  updatePlanner({ provider: event.target.value, model: provider?.models?.[0]?.id || '' })
                },
              },
              !textProviders.some(item => item.id === modelRouting.planner.provider) ? h('option', { value: modelRouting.planner.provider }, `${modelRouting.planner.provider}（当前配置）`) : null,
              textProviders.map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)))),
              h(Field, { label: '模型' }, textModels.length
                ? h('select', { className: 'tf-input', value: modelRouting.planner.model, disabled: isBusy('save-models'), onChange: event => updatePlanner({ model: event.target.value }) },
                    !textModels.some(item => item.id === modelRouting.planner.model) ? h('option', { value: modelRouting.planner.model }, `${modelRouting.planner.model}（自定义）`) : null,
                    textModels.map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)))
                : h('input', { className: 'tf-input', value: modelRouting.planner.model, disabled: isBusy('save-models'), onChange: event => updatePlanner({ model: event.target.value }) })),
              h(Field, { label: '最大输出 Token' }, h('input', { className: 'tf-input', type: 'number', min: 512, max: 32768, step: 1, value: modelRouting.planner.maxTokens, disabled: isBusy('save-models'), onChange: event => updatePlanner({ maxTokens: Number(event.target.value) }) })),
            ),
          ),
          h('div', { className: 'tf-model-group' },
            h('div', { className: 'tf-model-group-title' }, '图片与视频模型'),
            h('p', { className: 'tf-settings-hint' }, '每个生产阶段可独立选择已安装或导入的 ComfyUI 工作流。'),
            h('div', { className: 'tf-model-grid' },
              h(ModelSelect, { stage: 'characterImage', label: '角色定妆图' }),
              h(ModelSelect, { stage: 'startFrame', label: '章节起始帧' }),
              h(ModelSelect, { stage: 'keyframeImage', label: '连续关键帧' }),
              h(ModelSelect, { stage: 'chapterVideo', label: '章节长视频' }),
              h(ModelSelect, { stage: 'shotImage', label: '单镜图片' }),
              h(ModelSelect, { stage: 'shotVideo', label: '单镜视频' }),
            ),
          ),
          h('div', { className: 'tf-settings-footer' },
            h('button', { className: 'tf-btn tf-btn-ghost', disabled: isBusy('save-models') || !modelsDirty, onClick: () => setModelRouting(routingFromState(state)) }, '撤销'),
            h('button', { className: 'tf-btn', disabled: isBusy('save-models') || !modelsDirty || !modelRouting.planner.provider.trim() || !modelRouting.planner.model.trim(), onClick: saveModelRouting }, isBusy('save-models') ? '保存中…' : '保存模型'),
          ),
        ),
      ),

      h('div', { className: 'tf-settings-columns' },
        h('details', { className: 'tf-settings-section' },
          h('summary', { className: 'tf-settings-summary' }, h('span', null, '工作流'), h('span', { className: 'tf-settings-count' }, `${state?.templates?.length ?? '—'} 个${templatesDirty ? ' · 未保存' : ''}`)),
          h('div', { className: 'tf-settings-body' },
            !state ? h('div', { className: 'tf-settings-empty' }, '正在加载工作流…')
              : !state.templates?.length ? h('div', { className: 'tf-settings-empty' }, '暂无工作流')
                : state.templates.map(template => {
                  const testResult = workflowTests[template.id]
                  const testing = !!testingWorkflows[template.id]
                  const expanded = !!openWorkflows[template.id]
                  return h('div', { className: 'tf-settings-item tf-workflow-item', key: template.id, 'aria-busy': testing },
                  h('div', { className: 'tf-workflow-row' },
                    h('button', {
                      className: 'tf-workflow-toggle', 'aria-expanded': expanded,
                      onClick: () => setOpenWorkflows(current => ({ ...current, [template.id]: !expanded })),
                    },
                    h('span', { className: 'tf-workflow-chevron', 'aria-hidden': 'true' }, '›'),
                    h('span', { className: 'tf-comfy-name' }, template.title || template.id),
                    h('span', { className: 'tf-settings-meta' }, template.removable ? (template.capabilities?.mode || []).join(' · ') : '内置')),
                    h('div', { className: 'tf-workflow-actions' },
                      h('button', { className: 'tf-btn tf-btn-ghost tf-btn-small', title: baseDirty ? '请先保存 ComfyUI 地址' : '检查节点、输入结构与模型文件，不执行生成', disabled: testing || baseDirty, onClick: () => testWorkflow(template) }, testing ? '测试中…' : '测试'),
                      template.removable
                        ? h('button', { className: 'tf-link-danger', disabled: isBusy('delete') || testing, onClick: () => setPendingDelete({ type: 'template', item: template }) }, '删除')
                        : null,
                    ),
                  ),
                  testResult ? h('div', { className: `tf-workflow-test ${testResult.ready ? 'is-ready' : 'is-failed'}`, role: 'status' },
                    h('strong', null, testResult.ready ? '测试通过' : '测试未通过'),
                    h('span', null, `已检查 ${testResult.checked_nodes || 0} 类节点；未执行生成。`),
                    testResult.errors?.length ? h('ul', null, testResult.errors.slice(0, 6).map((error, index) => h('li', { key: `${error.code || 'error'}-${index}` }, workflowErrorText(error)))) : null,
                  ) : null,
                  expanded ? h('div', { className: 'tf-settings-item-body tf-workflow-body' },
                    h('div', { className: 'tf-card-meta' }, template.id),
                    template.prompt_hint ? h('p', { className: 'tf-settings-hint' }, template.prompt_hint) : null,
                    h(Field, { label: 'AI 使用说明' }, h('textarea', {
                      className: 'tf-textarea tf-comfy-note', value: templateNotes[template.id] || '', placeholder: '底模、提示词格式和限制说明', disabled: isBusy('save-templates'),
                      onChange: event => setTemplateNotes({ ...templateNotes, [template.id]: event.target.value }),
                    })),
                    !template.removable ? h('div', { className: 'tf-settings-protected' }, '内置工作流由插件维护，不可删除') : null,
                  ) : null,
                )}),
            h('div', { className: 'tf-settings-footer' },
              h('button', { className: 'tf-btn tf-btn-ghost', disabled: isBusy('save-templates') || !templatesDirty, onClick: () => setTemplateNotes(notesFromState(state)) }, '撤销'),
              h('button', { className: 'tf-btn', disabled: isBusy('save-templates') || !templatesDirty, onClick: saveTemplateNotes }, isBusy('save-templates') ? '保存中…' : '保存注释'),
            ),
            h('details', { className: 'tf-settings-advanced' },
              h('summary', null, '高级：导入 API 工作流'),
              h('div', { className: 'tf-settings-stack' },
                h('p', { className: 'tf-settings-hint' }, '供维护人员使用。路径位于运行 Elysium 的服务器；扫描不会执行模型。'),
                h(Field, { label: 'API Format JSON 绝对路径' }, h('input', { className: 'tf-input', value: workflow.path, disabled: isBusy('scan') || isBusy('import'), onChange: event => { setWorkflow({ ...workflow, path: event.target.value }); setDraft(null) } })),
                h('div', { className: 'tf-settings-line' },
                  h(Field, { label: '模板 ID（可留空）' }, h('input', { className: 'tf-input', value: workflow.id, disabled: isBusy('scan') || isBusy('import'), onChange: event => setWorkflow({ ...workflow, id: event.target.value }) })),
                  h(Field, { label: '显示名称（可留空）' }, h('input', { className: 'tf-input', value: workflow.title, disabled: isBusy('scan') || isBusy('import'), onChange: event => setWorkflow({ ...workflow, title: event.target.value }) })),
                ),
                h('div', { className: 'tf-settings-footer' },
                  h('button', { className: 'tf-btn tf-btn-ghost', disabled: isBusy('scan') || isBusy('import') || !workflow.path.trim(), onClick: scan }, isBusy('scan') ? '扫描中…' : '扫描'),
                  h('button', { className: 'tf-btn', disabled: isBusy('scan') || isBusy('import') || !draftCurrent, onClick: importWorkflow }, isBusy('import') ? '导入中…' : '确认导入'),
                ),
                draft && !draftCurrent ? h('div', { className: 'tf-settings-warning', role: 'status' }, '导入参数已变化，请重新扫描。') : null,
                draftCurrent ? h('pre', { className: 'tf-comfy-pre', 'aria-label': '工作流扫描摘要' }, JSON.stringify(draft.preview, null, 2)) : null,
              ),
            ),
          ),
        ),

        h('details', { className: 'tf-settings-section', open: true },
          h('summary', { className: 'tf-settings-summary' }, h('span', null, 'LoRA'), h('span', { className: 'tf-settings-count' }, `${configuredCount} 个已配置 · ${state?.availableLoras?.length ?? '—'} 个远程${lorasDirty ? ' · 未保存' : ''}`)),
          h('div', { className: 'tf-settings-body' },
            !state ? h('div', { className: 'tf-settings-empty' }, '正在加载 LoRA…')
              : !loras.length ? h('div', { className: 'tf-settings-empty' }, '暂无 LoRA 配置')
                : loras.map((item, index) => {
                  const serverState = item.on_server === true ? '远程可用' : item.on_server === false ? '远程缺失' : '远程未知'
                  const serverTone = item.on_server === true ? 'is-online' : item.on_server === false ? 'is-missing' : 'is-unknown'
                  const saved = state.loras?.find(value => value.name === item.name)
                  return h('details', { className: 'tf-settings-item', key: item.name },
                    h('summary', null,
                      h('span', { className: 'tf-comfy-name' }, item.name),
                      h('span', { className: `tf-settings-state ${serverTone}` }, serverState),
                    ),
                    h('div', { className: 'tf-settings-item-body tf-settings-stack' },
                      item.usedBy?.length ? h('div', { className: 'tf-card-meta' }, `工作流引用：${item.usedBy.join(', ')}`) : null,
                      item.in_registry === false ? h('div', { className: 'tf-settings-hint' }, '尚未添加自定义配置；编辑后保存即可启用。') : null,
                      h(Field, { label: '触发词' }, h('input', { className: 'tf-input', value: item.triggerWords || '', disabled: isBusy('save-loras'), onChange: event => updateLora(index, { triggerWords: event.target.value }) })),
                      h(Field, { label: '应用方式' }, h('select', { className: 'tf-input', value: item.mode, disabled: isBusy('save-loras'), onChange: event => updateLora(index, { mode: event.target.value }) },
                        h('option', { value: 'both' }, '加载模型并写入提示词'), h('option', { value: 'model-only' }, '仅加载模型'),
                      )),
                      h(Field, { label: 'AI 使用说明' }, h('textarea', { className: 'tf-textarea tf-comfy-note', value: item.note || '', placeholder: '建议权重、适用工作流和限制', disabled: isBusy('save-loras'), onChange: event => updateLora(index, { note: event.target.value }) })),
                      item.in_registry !== false
                        ? h('button', { className: 'tf-link-danger', disabled: isBusy('delete') || isBusy('save-loras'), onClick: () => removeLora(item) }, saved?.in_registry ? '移除自定义配置' : '移除未保存项')
                        : null,
                    ),
                  )
                }),
            h('div', { className: 'tf-comfy-add' },
              h(Field, { composite: true, label: connected ? '添加远程 LoRA' : '添加 LoRA 文件名', hint: connected ? '输入关键字筛选远程文件；添加后需保存。' : '当前未连接，可手动登记文件名；添加后需保存。' },
                h('div', { className: 'tf-settings-line' },
                  h('input', { className: 'tf-input tf-comfy-filter', 'aria-label': connected ? '筛选远程 LoRA' : 'LoRA 文件名', value: filter, placeholder: connected ? '筛选文件' : '文件名.safetensors', disabled: isBusy('save-loras'), onChange: event => setFilter(event.target.value) }),
                  connected ? h('select', { className: 'tf-input tf-comfy-picker', 'aria-label': '远程 LoRA 文件', value: selected, disabled: isBusy('save-loras') || !choices.length, onChange: event => setPick(event.target.value) }, choices.length ? choices.slice(0, 400).map(name => h('option', { key: name, value: name }, name)) : h('option', { value: '' }, '没有可添加项')) : null,
                  h('button', {
                    className: 'tf-btn tf-btn-ghost', disabled: isBusy('save-loras') || !(connected ? selected : filter.trim()),
                    onClick: () => {
                      const name = connected ? selected : filter.trim()
                      if (!name || registered.has(name)) return
                      setLoras(current => [...current, { name, triggerWords: '', mode: 'both', note: '', usedBy: [], on_server: connected ? true : null, in_registry: true }].sort((a, b) => a.name.localeCompare(b.name)))
                      setPick(''); setFilter('')
                      setNotice({ ok: true, text: `已将 ${name} 加入草稿，请保存 LoRA。` })
                    },
                  }, '添加'),
                ),
              ),
            ),
            h('div', { className: 'tf-settings-footer' },
              h('button', { className: 'tf-btn tf-btn-ghost', disabled: isBusy('save-loras') || !lorasDirty, onClick: () => setLoras((state?.loras || []).map(item => ({ ...item }))) }, '撤销'),
              h('button', { className: 'tf-btn', disabled: isBusy('save-loras') || !lorasDirty, onClick: saveLoras }, isBusy('save-loras') ? '保存中…' : '保存 LoRA'),
            ),
          ),
        ),
      ),

      pendingDelete ? h(ConfirmDialog, {
        title: pendingDelete.type === 'template' ? '删除导入的工作流' : '移除 LoRA 自定义配置',
        message: pendingDelete.type === 'template'
          ? `将永久删除“${pendingDelete.item.title || pendingDelete.item.id}”的合同与工作流文件，且无法恢复。`
          : `将移除“${pendingDelete.item.name}”的触发词、应用方式和 AI 使用说明；远程模型文件不会被删除。`,
        busy: isBusy('delete'),
        onClose: () => setPendingDelete(null),
        onConfirm: confirmDelete,
      }) : null,
    )
  }
}
