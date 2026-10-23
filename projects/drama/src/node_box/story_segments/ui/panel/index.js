import { element } from '../../../../client/ui/panel-dom.js'
import { readable } from '../../../../client/ui/readable.js'
import { showToast } from '@agent-modules/ui'

const labels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.onclick = action; return node }

export const panel = {
  type: 'story_segments', key: 'story_segments', title: '故事大纲',
  render(root, project, { state, openTasks, openRules, saveOpinion, story = {} }) {
    const node = project.story_segments, rows = node.segments, local = state.storyUi ||= {}
    const incoming = ['queued', 'running'].includes(story.execution?.status) ? story.execution : null
    if (!incoming || incoming.group_id !== local.runningExecution?.group_id) local.runningExecution = null
    if (incoming?.status === 'running') local.runningExecution = structuredClone(incoming)
    const active = incoming?.status === 'queued' && local.runningExecution?.group_id === incoming.group_id ? local.runningExecution : incoming
    const busy = !!active || !!local.submitting
    const dataState = busy ? active?.node_state_before || local.nodeBefore || node.node_state : node.node_state
    const section = element('section', '', 'production-section script-node'), head = element('div', '', 'section-head')
    section.dataset.nodeType = 'story_segments'; section.dataset.status = dataState.status
    head.append(element('h3', '故事大纲'), element('span', labels[dataState.status] || '未生成', 'node-data-tag'))
    if (rows.length) head.append(element('span', `${rows.length} 段 · ${rows.reduce((sum, row) => sum + row.duration_seconds, 0)} 秒`, 'production-count'))
    section.append(head)
    const ui = element('div', '', 'node-ui'), buttons = element('div', '', 'node-ui-buttons'), records = element('nav', '', 'node-ui-records'), actions = element('div', '', 'node-ui-execution')
    records.setAttribute('aria-label', '故事大纲记录与规则')
    if (openTasks) records.append(button('任务历史', () => openTasks('story_segments', '故事大纲')))
    if (openRules) records.append(button('查看规则', () => openRules('story_segments', '故事大纲')))
    if (rows.length) records.append(button('复制大纲', async () => {
      try { await root.ownerDocument.defaultView.navigator.clipboard.writeText(readable({ segments: rows })); showToast('已复制') }
      catch { showToast('复制失败，请重试') }
    }))
    const input = element('input', '', 'node-ui-opinion'), error = element('p', local.error || '', 'error node-ui-failure')
    input.placeholder = '本次执行意见'; input.setAttribute('aria-label', '故事大纲本次执行意见')
    state.nodeOpinions ||= {}
    input.value = state.nodeOpinions.story_segments ?? node.node_state.opinion ?? ''
    input.oninput = () => { state.nodeOpinions.story_segments = input.value }
    let saved = node.node_state.opinion || '', chain = Promise.resolve()
    input.onblur = () => {
      const value = input.value
      chain = chain.then(async () => {
        if (!saveOpinion || value === saved) return
        error.textContent = ''; input.setAttribute('aria-busy', 'true')
        try { await saveOpinion('story_segments', value, saved); saved = value }
        catch (failure) { error.textContent = failure.message }
        finally { input.removeAttribute('aria-busy') }
      })
    }
    const run = button(rows.length ? '按意见修改' : 'AI生成', async () => {
      if (run.disabled || local.submitting || !story.isCurrent?.()) return
      const instruction = input.value.trim() || (rows.length ? '按项目规则修改故事大纲' : '按当前工作剧本生成完整故事大纲')
      local.submitting = true; local.error = ''; local.nodeBefore = structuredClone(node.node_state)
      if (local.request?.instruction !== instruction) local.request = { instruction, id: root.ownerDocument.defaultView.crypto.randomUUID() }
      story.repaint()
      try {
        await chain
        const result = await story.generate(instruction, local.request.id)
        if (!story.isCurrent()) return
        story.setExecution({ group_id: result.group_id, status: result.status, node_state_before: local.nodeBefore })
        local.request = null
        story.refresh?.()
      } catch (failure) { if (story.isCurrent()) local.error = failure.message }
      finally { local.submitting = false; if (story.isCurrent()) story.repaint() }
    })
    run.disabled = busy || !story.generate || !project.basic_info.actual_script.trim()
    run.title = !project.basic_info.actual_script.trim() ? '请先导入剧本' : busy ? '大纲任务正在执行' : '仅生成或修改故事大纲'
    actions.append(run); buttons.append(records, actions); ui.append(buttons, input, error)
    error.setAttribute('role', 'status')
    if (busy) {
      const step = active?.step, issues = active?.review_issues || [], repairing = step?.kind === 'revise' && issues.length > 0
      const phase = { generate: '生成', review: '审核', revise: repairing ? '修订' : '生成' }[step?.kind]
      const progress = !active ? '正在提交大纲任务…' : active.status === 'queued' ? '排队中，等待执行…'
        : phase ? `正在${phase}故事大纲，等待模型返回…` : '正在执行故事大纲任务…'
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
    if (!rows.length) section.append(element('p', '暂无故事大纲', 'production-empty'))
    rows.forEach((row, index) => {
      const card = element('article', '', 'production-card')
      card.append(element('h4', `${index + 1}. ${row.title}`), element('p', row.body, 'production-text'))
      const detail = element('details'), summary = element('summary', '锚点、场景与衔接')
      const { title, body, ...fields } = row
      detail.append(summary, element('p', readable(fields), 'production-text')); card.append(detail); section.append(card)
    })
    root.append(section)
  },
}
