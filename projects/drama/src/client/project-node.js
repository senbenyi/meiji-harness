import { element } from './panel-dom.js'

// 实际复制自meiji/client/task-panel.js的nodeCard/nodeUi剧本分支。
// 只适配drama数据与回调；不复制meiji业务执行、旧模型或其他节点分支。
const labels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
const button = (label, action, aria) => { const node = element('button', label); node.type = 'button'; node.onclick = action; if (aria) node.setAttribute('aria-label', aria); return node }

export function backHeader(root, title, label, back) {
  const bar = element('div', '', 'episode-bar'), b = button('←', back, label)
  b.className = 'episode-back'
  bar.append(b, element('h2', title)); root.append(bar)
}

export function scriptNodeCard(node, { openRules, openTasks, saveOpinion, opinionDraft = node.opinion || '', setOpinionDraft, copyText } = {}) {
  const card = element('section', '', 'session-project script-node'), head = element('div', '', 'section-head'), titles = element('div', '', 'section-titles')
  card.dataset.business = 'script_revision'; card.dataset.section = 'script_revision'; card.dataset.status = node.node_state?.status || 'empty'
  titles.append(element('h3', '剧本优化(可选)'), element('span', labels[node.node_state?.status] || '未生成', 'node-data-tag'))
  head.append(titles); card.append(head)
  const ui = element('div', '', 'node-ui'), actions = element('div', '', 'workflow-generation-row'), buttons = element('div', '', 'node-ui-buttons')
  const execution = element('div', '', 'node-ui-execution'), records = element('nav', '', 'node-ui-records')
  records.setAttribute('aria-label', '剧本记录与规则'); execution.setAttribute('role', 'group'); execution.setAttribute('aria-label', '剧本操作')
  // 改编执行尚未接入，保持原来的禁用状态。
  const control = button('按意见改编'); control.disabled = true; control.title = '暂不可用'; execution.append(control)
  if (openTasks) records.append(button('任务历史', openTasks, '查看剧本优化任务记录'))
  if (openRules) records.append(button('查看规则', openRules, '查看剧本优化规则'))
  buttons.append(records, execution)
  actions.append(buttons)
  const input = element('input', '', 'node-ui-opinion'), error = element('p', '', 'error node-ui-failure')
  input.placeholder = '本次执行意见'; input.setAttribute('aria-label', '本次执行意见'); input.value = opinionDraft
  error.setAttribute('role', 'status')
  let saved = node.opinion || '', chain = Promise.resolve()
  input.oninput = () => setOpinionDraft?.(input.value)
  input.onblur = () => {
    const value = input.value
    chain = chain.then(async () => {
      if (!saveOpinion || value === saved) return
      input.setAttribute('aria-busy', 'true'); error.textContent = ''
      try { await saveOpinion(value, saved); saved = value }
      catch (failure) { error.textContent = failure.message }
      finally { input.removeAttribute('aria-busy') }
    })
  }
  ui.append(actions, input, error)
  if (node.node_state?.reason) ui.append(element('p', `${node.node_state.status === 'rejected' ? '未通过原因' : '状态原因'}：${node.node_state.reason}`, 'error node-ui-reason'))
  card.append(ui)
  const output = node.output || {}
  if (!output.body?.trim() && !output.summary && !output.estimated_duration_seconds) return card
  const result = element('div', '', 'node-result')
  card.append(result)
  if (output.estimated_duration_seconds) result.append(element('p', `预估时长 ${output.estimated_duration_seconds} 秒`, 'meta'))
  if (output.summary) result.append(element('p', output.summary, 'summary'))
  if (output.body?.trim()) result.append(element('p', output.body, 'prompt full'))
  if (!output.body?.trim()) return card
  const row = element('div', '', 'json-copy-row'), copy = button('复制原文', async () => {
    copy.disabled = true
    try { await (copyText || (text => card.ownerDocument.defaultView.navigator.clipboard.writeText(text)))(output.body || ''); copy.textContent = '已复制' }
    catch { copy.textContent = '复制失败，请重试' }
    finally { copy.disabled = false }
  }, '复制该卡片原文')
  copy.className = 'json-copy'; row.append(copy); result.prepend(row)
  return card
}
