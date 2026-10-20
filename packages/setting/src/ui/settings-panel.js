import { SettingsModel } from '../index.js'

const styles = `
:host{display:block;color:#e8e9ed;font:14px/1.6 system-ui,sans-serif}
*{box-sizing:border-box}
button,select{font:inherit;color:inherit}
button{cursor:pointer;background:none;border:1px solid #383a41;border-radius:8px;padding:7px 12px}
button:hover{background:#30323a}
button:disabled,select:disabled{opacity:.5;cursor:default}
h2{font-size:18px;margin:0}
h3{font-size:15px;margin:0 0 8px}
.settings-page .back{margin-bottom:12px}
.settings-group{margin:20px 0 16px;padding:16px;border:1px solid #383a41;border-radius:10px;background:#23252c}
.settings-group>h3{margin-top:0}
.settings-option{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:12px 0}
.settings-option select{width:220px;max-width:60%;margin:0;background:#23252c;border:1px solid #444852;border-radius:8px;padding:10px;color:#eee}
select:focus{outline:2px solid #b89e77;outline-offset:1px}
.settings-error{color:#f2a8a8;margin:0}
.settings-error:empty{display:none}
`

function element(document, tag, text = '', className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}

function selectionOf(value, spec) {
  return new SettingsModel(value, spec).toJSON()
}

/** 设置页：语言与模型分组、选择后保存、失败回退。返回带 Shadow DOM 的元素。 */
export function renderSettingsPanel(spec, {
  document = globalThis.document, value, store, busy = false, title = '设置', onBack, onSaved,
} = {}) {
  if (!document?.createElement) throw new TypeError('设置页需要浏览器 document')
  if (value == null && !store) throw new TypeError('设置页需要 value 或 store')
  const host = element(document, 'div')
  const root = host.attachShadow({ mode: 'open' })
  root.append(element(document, 'style', styles))
  const page = element(document, 'section', '', 'settings-page')
  const back = element(document, 'button', '← 返回', 'back')
  back.type = 'button'
  if (onBack) back.onclick = onBack
  else back.hidden = true
  page.append(back, element(document, 'h2', title))

  const languageField = spec.language?.field || 'output_language'
  const languageMessage = element(document, 'p', '', 'settings-error')
  languageMessage.setAttribute('role', 'status')
  let language
  if (spec.language) {
    const group = element(document, 'section', '', 'settings-group')
    language = element(document, 'select')
    language.name = languageField
    const labelText = spec.language.title || '生成语言'
    language.setAttribute('aria-label', labelText)
    for (const item of spec.language.options) {
      const option = element(document, 'option', item.label)
      option.value = item.value
      language.append(option)
    }
    const label = element(document, 'label', labelText, 'settings-option')
    label.append(language)
    group.append(element(document, 'h3', '语言'), label, languageMessage)
    page.append(group)
  }

  const modelGroup = element(document, 'section', '', 'settings-group')
  modelGroup.append(element(document, 'h3', '模型'))
  const modelMessage = element(document, 'p', '', 'settings-error')
  modelMessage.setAttribute('role', 'status')
  const selects = []
  for (const [purpose, entry] of Object.entries(spec.models)) {
    const select = element(document, 'select')
    select.name = purpose
    const labelText = entry.title || purpose
    select.setAttribute('aria-label', labelText)
    for (const item of entry.options) {
      const option = element(document, 'option', item.label)
      option.value = item.value
      select.append(option)
    }
    const label = element(document, 'label', labelText, 'settings-option')
    label.append(select)
    modelGroup.append(label)
    selects.push(select)
  }
  modelGroup.append(modelMessage)
  page.append(modelGroup)
  root.append(page)

  let current = null
  let saving = false
  let loaded = false
  const lock = () => {
    const disabled = busy || saving || !loaded
    if (language) language.disabled = disabled
    for (const select of selects) select.disabled = disabled
  }
  const show = data => {
    current = data
    loaded = true
    if (language) {
      language.value = data[languageField]
      language.dataset.saved = language.value
    }
    for (const select of selects) select.value = data[select.name].model
    lock()
  }
  const persist = async patch => {
    const next = { ...current, ...patch }
    const saved = store ? await store.write(next) : { ...next, ...selectionOf(next, spec) }
    show(saved)
    onSaved?.(saved)
    return saved
  }
  if (language) language.onchange = async () => {
    const previous = language.dataset.saved
    saving = true
    languageMessage.textContent = ''
    lock()
    try { await persist({ [languageField]: language.value }) }
    catch (error) {
      language.value = previous
      languageMessage.textContent = error.message
    } finally {
      saving = false
      lock()
    }
  }
  for (const select of selects) select.onchange = async () => {
    const previous = current[select.name].model
    saving = true
    modelMessage.textContent = ''
    lock()
    try { await persist({ [select.name]: { model: select.value } }) }
    catch (error) {
      select.value = previous
      modelMessage.textContent = error.message
    } finally {
      saving = false
      lock()
    }
  }

  let resolveReady
  let rejectReady
  host.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  host.setBusy = value => { busy = Boolean(value); lock() }
  lock()
  const start = value == null ? Promise.resolve(null) : Promise.resolve().then(() => selectionOf(value, spec))
  start.then(initial => {
    if (initial) show(initial)
    if (!store) return initial
    return store.read().then(data => { show(data); return data })
  }).then(data => resolveReady(data), error => {
    modelMessage.textContent = error.message
    rejectReady(error)
  })
  return host
}
