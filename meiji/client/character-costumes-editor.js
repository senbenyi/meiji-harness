import { element } from './panel-dom.js'

export function costumesEditor(initial = []) {
  const section = element('section', '', 'character-costumes-editor'), rows = []
  section.append(element('h4', '全部服装'), element('p', '每套服装保存名称和描述。保存后分配固定 ID。', 'meta'))
  const list = element('div'), add = element('button', '＋ 添加服装'); add.type = 'button'
  const append = (item = {}) => {
    const row = element('fieldset'), inputs = {}
    row.append(element('legend', item.id ? `服装 ${item.id}` : '新服装'))
    for (const [key, title] of [['name', '服装名称'], ['description', '服装描述']]) {
      const label = element('label'), input = element(key === 'description' ? 'textarea' : 'input')
      input.value = item[key] || ''; input.maxLength = 10000; input.setAttribute('aria-label', title)
      label.append(element('span', title), input); row.append(label); inputs[key] = input
    }
    const remove = element('button', '移除服装'); remove.type = 'button'
    const record = { row, item, inputs }
    remove.onclick = () => { rows.splice(rows.indexOf(record), 1); row.remove(); section.dispatchEvent(new section.ownerDocument.defaultView.Event('change', { bubbles: true })) }
    row.append(remove); rows.push(record); list.append(row)
  }
  add.onclick = () => { append(); section.dispatchEvent(new section.ownerDocument.defaultView.Event('change', { bubbles: true })) }
  initial.forEach(append); section.append(list, add)
  return { element: section, value: () => rows.map(({ item, inputs }) => ({ id: item.id || '', ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()])) })) }
}
