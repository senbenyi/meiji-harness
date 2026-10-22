import { element } from './panel-dom.js'

// 从本项目已复制的meiji创建弹窗提取导入控件，原文只通过导入更新，无文本编辑器。
export function scriptImport(root, { importScript, listScripts, readScript } = {}) {
  const group = element('div', '', 'project-script-import'), row = element('div', '', 'workflow-generation-row'),
    imp = element('button', '本地导入', 'script-import'), choose = element('button', '素材库导入', 'script-choose'),
    file = element('input'), picker = element('select', '', 'script-picker'), error = element('p', '', 'error')
  let ticket = 0, disposed = false, busy = false
  file.type = 'file'; file.accept = '.txt,.text,.md'; file.hidden = true; file.setAttribute('aria-label', '导入项目剧本文件')
  picker.hidden = true; picker.setAttribute('aria-label', '选择项目剧本'); error.setAttribute('role', 'status')
  imp.type = choose.type = 'button'; choose.hidden = !listScripts || !readScript
  const active = value => !disposed && value === ticket
  const setBusy = value => { busy = value; imp.disabled = choose.disabled = picker.disabled = value }
  imp.onclick = () => { if (!busy) file.click() }
  file.onchange = async () => {
    const n = ++ticket, selected = file.files?.[0]
    if (!selected) return
    try {
      if (!/\.(txt|text|md)$/i.test(selected.name)) throw Error('请选择TXT或Markdown剧本')
      if (selected.size > 1024 * 1024) throw Error('剧本不能超过1MB')
      setBusy(true); error.textContent = ''
      const body = await selected.text()
      if (!active(n)) return
      if (!body.trim()) throw Error('剧本不能为空')
      await importScript(body, selected.name)
    } catch (failure) { if (active(n)) error.textContent = failure.message }
    finally { if (active(n)) { file.value = ''; setBusy(false) } }
  }
  choose.onclick = async () => {
    const n = ++ticket
    try {
      setBusy(true); error.textContent = ''
      const assets = await listScripts()
      if (!active(n)) return
      picker.replaceChildren(element('option', '请选择剧本')); picker.firstChild.value = ''
      for (const asset of assets.filter(item => item.category === 'scripts')) {
        const option = element('option', asset.originalName); option.value = asset.id; picker.append(option)
      }
      picker.hidden = false
      if (picker.options.length === 1) error.textContent = '素材库暂无剧本，请先在片库的素材 / 剧本中导入'
    } catch (failure) { if (active(n)) error.textContent = failure.message }
    finally { if (active(n)) setBusy(false) }
  }
  picker.onchange = async () => {
    const n = ++ticket, id = picker.value
    if (!id) return
    try {
      setBusy(true); error.textContent = ''
      const body = await readScript(id)
      if (active(n)) await importScript(body, picker.selectedOptions[0].textContent)
    } catch (failure) { if (active(n)) error.textContent = failure.message }
    finally { if (active(n)) setBusy(false) }
  }
  row.append(imp, choose); group.append(row, file, picker, error); root.insertBefore(group, root.querySelector(':scope > .script-view'))
  return () => { disposed = true; ticket++ }
}
