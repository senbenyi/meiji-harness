import { showToast } from '@agent-modules/ui'
import { element } from '../../../../client/ui/panel-dom.js'

// 实际复制自meiji/client/task-panel.js的nodeCard/nodeUi剧本分支。
// 只适配drama数据与回调；不复制meiji业务执行、旧模型或其他节点分支。
const labels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
const button = (label, action, aria) => { const node = element('button', label); node.type = 'button'; node.onclick = action; if (aria) node.setAttribute('aria-label', aria); return node }

export function scriptNodeCard(node, { preview = false, runOptimization, canOptimize = false, busy = false, executionStep = null, displayNodeState = null, reviewIssues = [], executionError = '', openRules, openTasks, saveOpinion, opinionDraft = node.node_state?.opinion || '', setOpinionDraft, copyText } = {}) {
  const card = element('section', '', 'session-project script-node'), head = element('div', '', 'section-head'), titles = element('div', '', 'section-titles')
  const output = node
  const dataState = busy && displayNodeState ? displayNodeState : node.node_state
  const waitingReview = node.node_state?.reason === '候选已保存，等待审核'
  const displayWaiting = dataState?.reason === '候选已保存，等待审核'
  const repairing = busy && executionStep?.kind === 'revise' && reviewIssues.length > 0
  const displayStatus = displayWaiting ? 'pending_review' : dataState?.status || 'empty'
  card.dataset.business = 'script_revision'; card.dataset.section = 'script_revision'; card.dataset.status = displayStatus
  if (executionStep?.kind) card.dataset.step = executionStep.kind
  titles.append(element('h3', '剧本优化(可选)'), element('span', displayWaiting ? '待审核' : labels[dataState?.status] || '未生成', 'node-data-tag'))
  head.append(titles); card.append(head)
  const ui = element('div', '', 'node-ui'), actions = element('div', '', 'workflow-generation-row'), buttons = element('div', '', 'node-ui-buttons')
  const execution = element('div', '', 'node-ui-execution'), records = element('nav', '', 'node-ui-records')
  records.setAttribute('aria-label', '剧本记录与规则'); execution.setAttribute('role', 'group'); execution.setAttribute('aria-label', '剧本操作')
  const control = button('按意见修改')
  control.disabled = busy || !canOptimize || !runOptimization
  control.title = !canOptimize ? '请先导入原始剧本' : busy ? '剧本任务正在执行' : '根据本次意见优化剧本'
  execution.append(control)
  if (openTasks) records.append(button('任务历史', openTasks, '查看剧本优化任务记录'))
  if (openRules) records.append(button('查看规则', openRules, '查看剧本优化规则'))
  if (output.actual_script?.trim()) {
    const copy = button('复制原文', async () => {
      try { await (copyText || (text => card.ownerDocument.defaultView.navigator.clipboard.writeText(text)))(output.actual_script); showToast('已复制') }
      catch { showToast('复制失败，请重试') }
    }, '复制该卡片原文')
    copy.className = 'node-original-copy'; records.append(copy)
  }
  buttons.append(records, execution)
  actions.append(buttons)
  const input = element('input', '', 'node-ui-opinion'), error = element('p', '', 'error node-ui-failure')
  input.placeholder = '本次执行意见'; input.setAttribute('aria-label', '本次执行意见'); input.value = opinionDraft
  error.setAttribute('role', 'status'); error.textContent = executionError
  let saved = node.node_state?.opinion || '', chain = Promise.resolve()
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
  control.onclick = async () => {
    if (control.disabled) return
    control.disabled = true; error.textContent = ''
    try { await chain; await runOptimization(input.value.trim() || '按项目创作要求优化剧本') }
    catch (failure) { error.textContent = failure.message }
    finally { control.disabled = busy || !canOptimize || !runOptimization }
  }
  ui.append(actions, input, error)
  const reviewReason = reviewIssues.map(issue => `${issue.location ? `${issue.location}：` : ''}${issue.reason}${issue.suggestion ? `；${issue.suggestion}` : ''}`).join('\n')
  if (busy) {
    const phase = { generate: '生成', review: '审核', revise: repairing ? '修订' : '生成' }[executionStep?.kind] || executionStep?.name || '前置（准备或等待执行）'
    const reason = repairing ? `\n未通过原因：${reviewReason}` : ''
    const notice = element('p', `当前步骤：${phase}${reason}`, `node-ui-step${repairing ? ' is-rejected' : ''}`)
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); ui.append(notice)
  } else if (node.node_state?.reason) {
    ui.append(element('p', waitingReview ? `当前步骤：待审核` : `${node.node_state.status === 'rejected' ? '未通过原因' : '状态原因'}：${node.node_state.reason}`, waitingReview ? 'node-ui-step' : 'error node-ui-reason'))
  }
  const last = node.node_state?.last_execution
  if (last && ['rejected', 'failed', 'cancelled'].includes(last.status)) {
    const result = { completed: '完成', rejected: '未通过', failed: '执行失败', cancelled: '已取消' }[last.status]
    const notice = element('p', `上次执行：${result}；${last.message}`, `node-last-execution${['failed', 'rejected'].includes(last.status) ? ' error' : ''}`)
    notice.dataset.stopCode = last.stop_code; notice.setAttribute('role', 'status'); ui.append(notice)
  }
  card.append(ui)
  if (!output.actual_script?.trim() && !output.summary) return card
  const result = element('div', '', 'node-result')
  card.append(result)
  if (preview) {
    if (output.actual_script?.trim() || output.summary) result.append(element('p', output.actual_script?.trim() ? output.actual_script : output.summary, 'prompt script-preview'))
  } else {
    if (output.summary) result.append(element('p', `摘要：${output.summary}`, 'summary'))
    if (output.actual_script?.trim()) result.append(element('p', output.actual_script, 'prompt full'))
  }
  return card
}

export const panel = { scriptNodeCard }
