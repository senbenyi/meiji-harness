import { element } from '../../../../client/ui/panel-dom.js'
import { readable } from '../../../../client/ui/readable.js'
import { showToast } from '@agent-modules/ui'

const labels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.onclick = action; return node }

export const panel = {
  type: 'group_setting', key: 'group_setting', title: '团队设定',
  render(root, project, { state, openTasks, openRules, saveOpinion, groups: operation = {}, otherBusy = false }) {
    const node = project.group_setting, rows = node.groups, hasRows = rows.length, local = state.groupUi ||= {}
    const incoming = ['queued', 'running'].includes(operation.execution?.status) ? operation.execution : null
    if (!incoming || incoming.group_id !== local.runningExecution?.group_id) local.runningExecution = null
    if (incoming?.status === 'running') local.runningExecution = structuredClone(incoming)
    const active = incoming?.status === 'queued' && local.runningExecution?.group_id === incoming.group_id ? local.runningExecution : incoming
    const busy = !!active || !!local.submitting
    const dataState = busy ? active?.node_state_before || local.nodeBefore || node.node_state : node.node_state
    const hasResult = !!hasRows || ['generated', 'expired'].includes(dataState.status)
    const section = element('section', '', 'production-section script-node role-module-card'), head = element('div', '', 'section-head')
    section.dataset.roleModule = 'groups'; section.dataset.nodeType = 'group_setting'; section.dataset.status = dataState.status
    head.append(element('h3', '团队设定'), element('span', labels[dataState.status] || '未生成', 'node-data-tag'))
    if (hasResult) head.append(element('span', `${rows.length} 个团队`, 'production-count'))
    section.append(head)
    const ui = element('div', '', 'node-ui'), buttons = element('div', '', 'node-ui-buttons'), records = element('nav', '', 'node-ui-records'), actions = element('div', '', 'node-ui-execution')
    records.setAttribute('aria-label', '团队记录与规则')
    if (openTasks) records.append(button('任务历史', () => openTasks('group_setting', '团队')))
    if (openRules) records.append(button('查看规则', () => openRules('group_setting', '团队')))
    if (hasRows) records.append(button('复制团队设定', async () => {
      try { await root.ownerDocument.defaultView.navigator.clipboard.writeText(readable({ groups: rows })); showToast('已复制') }
      catch { showToast('复制失败，请重试') }
    }))
    const input = element('input', '', 'node-ui-opinion'), error = element('p', local.error || '', 'error node-ui-failure')
    input.placeholder = '本次执行意见'; input.setAttribute('aria-label', '团队本次执行意见')
    state.nodeOpinions ||= {}
    input.value = state.nodeOpinions.group_setting ?? node.node_state.opinion ?? ''
    input.oninput = () => { state.nodeOpinions.group_setting = input.value }
    let saved = node.node_state.opinion || '', chain = Promise.resolve()
    input.onblur = () => {
      const value = input.value
      chain = chain.then(async () => {
        if (!saveOpinion || value === saved) return
        error.textContent = ''; input.setAttribute('aria-busy', 'true')
        try { await saveOpinion('group_setting', value, saved); saved = value }
        catch (failure) { error.textContent = failure.message }
        finally { input.removeAttribute('aria-busy') }
      })
    }
    const submit = async (control, regenerate = false) => {
      if (control.disabled || local.submitting || !operation.isCurrent?.()) return
      const instruction = regenerate ? `按当前故事大纲和最新项目规则重新生成需要统一着装的团队，简短描述基本形象、团队状态和统一服装；不纳入群众，旧资料仅供复用仍适用的稳定ID，不作为必须保留的基稿。${input.value.trim() ? `本次要求：${input.value.trim()}` : ''}` : input.value.trim() || (hasRows ? '按项目规则修改团队基本形象与共同服装' : '按当前故事大纲设定完整团队基本形象及适合年代、场景和剧情的共同服装')
      local.submitting = true; local.error = ''; local.nodeBefore = structuredClone(node.node_state)
      if (local.request?.instruction !== instruction || local.request?.regenerate !== regenerate) local.request = { instruction, regenerate, id: root.ownerDocument.defaultView.crypto.randomUUID() }
      operation.repaint()
      try {
        await chain
        const result = await operation.generate(instruction, local.request.id, ...(regenerate ? [{ regenerate: true }] : []))
        if (!operation.isCurrent()) return
        operation.setExecution({ group_id: result.group_id, status: result.status, node_state_before: local.nodeBefore })
        local.request = null
        operation.refresh?.()
      } catch (failure) { if (operation.isCurrent()) local.error = failure.message }
      finally { local.submitting = false; if (operation.isCurrent()) operation.repaint() }
    }
    const run = button(hasRows ? '按意见修改' : hasResult ? '重新生成' : '生成团队设定', () => submit(run, !hasRows && hasResult))
    const regenerate = button('重新生成', () => submit(regenerate, true))
    run.disabled = regenerate.disabled = busy || otherBusy || !operation.generate || !project.story_segments.segments.length
    run.title = !project.story_segments.segments.length ? '请先生成故事大纲' : busy ? '团队任务正在执行' : '仅生成或修改团队'
    regenerate.title = '按当前资料和项目规则重新生成'
    if (hasRows) actions.append(regenerate)
    actions.append(run); buttons.append(records, actions); ui.append(buttons, input, error)
    error.setAttribute('role', 'status')
    if (busy) {
      const step = active?.step, issues = active?.review_issues || [], repairing = step?.kind === 'revise' && issues.length > 0
      const phase = { generate: '生成', review: '审核', revise: repairing ? '修订' : '生成' }[step?.kind]
      const progress = !active ? '正在提交团队任务…' : active.status === 'queued' ? '排队中，等待执行…'
        : phase ? `正在${phase}团队，等待模型返回…` : '正在执行团队任务…'
      const notice = element('p', `${progress}${repairing ? `\n未通过原因：${issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n')}` : ''}`, `node-ui-step${repairing ? ' is-rejected' : ''}`)
      notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); ui.append(notice)
    } else {
      if (node.node_state.reason) ui.append(element('p', node.node_state.reason, 'error node-ui-reason'))
      const last = node.node_state.last_execution
      if (last && ['failed', 'rejected', 'cancelled'].includes(last.status)) {
        const notice = element('p', `上次执行：${last.message}`, 'node-last-execution error'); notice.dataset.stopCode = last.stop_code; ui.append(notice)
      }
    }
    section.append(ui)
    if (!rows.length) {
      const completed = !busy && node.node_state.status === 'generated' && node.node_state.last_execution?.status === 'completed'
      const message = completed ? '团队提取已完成，本次未发现需要统一的团队'
        : dataState.status === 'generated' ? '本次未提取到需要统一着装的团队。' : '暂无团队设定；可独立生成，无团队时返回空集合并审核。'
      section.append(element('p', message, `production-meta group-empty-notice${completed ? ' is-completed' : ''}`))
    }
    for (const [index, group] of rows.entries()) {
      const card = element('article', '', 'production-card group-details')
      card.append(element('h4', `${index + 1}. ${group.name}`), element('p', readable(group), 'production-text'))
      section.append(card)
    }
    root.append(section)
  },
}
