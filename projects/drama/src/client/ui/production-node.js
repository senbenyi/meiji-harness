import { element } from './panel-dom.js'
import { readable } from './readable.js'

const statusLabels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
export function renderProductionNode(root, { title, rows, node, nodeType, state, openTasks, openRules, saveOpinion, generateLabel }) {
  const section = element('section', '', 'production-section'), head = element('div', '', 'section-head')
  head.append(element('h3', title), element('span', rows.length ? `${rows.length} 项` : statusLabels[node?.node_state?.status] || '未生成', 'production-count'))
  section.dataset.nodeType = nodeType
  section.append(head)
  const ai = node?.node_state?.type === 1
  section.classList.add('script-node')
  section.dataset.status = node?.node_state?.status || 'empty'
  const tag = element('span', statusLabels[node?.node_state?.status] || '未生成', 'node-data-tag')
  head.querySelector('h3').after(tag)
  if (!rows.length) head.querySelector('.production-count').remove()
  const ui = element('div', '', 'node-ui'), buttons = element('div', '', 'node-ui-buttons')
  const records = element('nav', '', 'node-ui-records'), execution = element('div', '', 'node-ui-execution')
  records.setAttribute('aria-label', `${title}记录与规则`)
  const button = (label, callback) => {
    const control = element('button', label); control.type = 'button'; control.disabled = !callback; control.onclick = callback
    return control
  }
  records.append(button('任务历史', openTasks ? () => openTasks(nodeType, title) : undefined))
  if (ai) records.append(button('查看规则', openRules ? () => openRules(nodeType, title) : undefined))
  const generate = button(generateLabel || (ai ? 'AI生成' : '生成/修改'))
  generate.title = '该节点尚未接入执行器'
  execution.append(generate)
  if (ai) {
    const modify = button('修改')
    modify.title = '该节点尚未接入执行器'
    execution.append(modify)
  }
  buttons.append(records, execution); ui.append(buttons)
  if (ai) {
    state.nodeOpinions ||= {}
    const input = element('input', '', 'node-ui-opinion'), error = element('p', '', 'error node-ui-failure')
    input.placeholder = '本次执行意见'; input.setAttribute('aria-label', `${title}本次执行意见`)
    input.value = state.nodeOpinions[nodeType] ?? node.node_state.opinion ?? ''; input.readOnly = !saveOpinion
    error.setAttribute('role', 'status')
    let saved = node.node_state.opinion ?? '', chain = Promise.resolve()
    input.oninput = () => { state.nodeOpinions[nodeType] = input.value }
    input.onblur = () => {
      const value = input.value
      chain = chain.then(async () => {
        if (!saveOpinion || value === saved) return
        input.setAttribute('aria-busy', 'true'); error.textContent = ''
        try { await saveOpinion(nodeType, value, saved); saved = value }
        catch (failure) { error.textContent = failure.message }
        finally { input.removeAttribute('aria-busy') }
      })
    }
    ui.append(input, error)
  }
  if (node?.node_state?.last_execution) {
    const last = node.node_state.last_execution
    const notice = element('p', `上次执行：${last.message}`, 'node-last-execution')
    notice.dataset.stopCode = last.stop_code; ui.append(notice)
  }
  section.append(ui)
  if (!rows.length) section.append(element('p', `暂无${title}`, 'production-empty'))
  rows.forEach((row, index) => {
    const value = row.video_generation || row
    const card = element('article', '', 'production-card')
    const label = row.title || row.name || (title === '分集' ? `第 ${index + 1} 集` : `${title} ${index + 1}`)
    card.append(element('h4', label))
    if (row.clip_id) card.append(element('p', row.clip_id, 'production-meta'))
    const { title: _title, name: _name, ...fields } = value
    const text = readable(fields)
    if (text) card.append(element('p', text, 'production-text'))
    section.append(card)
  })
  root.append(section)
}
