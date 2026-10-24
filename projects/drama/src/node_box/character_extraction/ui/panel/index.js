import { element } from '../../../../client/ui/panel-dom.js'
import { renderCostumeImages, renderImageBatch } from '../../../costume_image/ui/panel/index.js'
import { readable } from '../../../../client/ui/readable.js'
import { showToast } from '@agent-modules/ui'

const labels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.onclick = action; return node }

export const panel = {
  type: 'character_extraction', key: 'character_extraction', title: '角色',
  render(root, project, { state, openTasks, openRules, saveOpinion, characters = {}, images = {} }) {
    const node = project.character_extraction, rows = node.characters, local = state.characterUi ||= {}
    const incoming = ['queued', 'running'].includes(characters.execution?.status) ? characters.execution : null
    if (!incoming || incoming.group_id !== local.runningExecution?.group_id) local.runningExecution = null
    if (incoming?.status === 'running') local.runningExecution = structuredClone(incoming)
    const active = incoming?.status === 'queued' && local.runningExecution?.group_id === incoming.group_id ? local.runningExecution : incoming
    const busy = !!active || !!local.submitting
    const dataState = busy ? active?.node_state_before || local.nodeBefore || node.node_state : node.node_state
    const section = element('section', '', 'production-section script-node'), head = element('div', '', 'section-head')
    section.dataset.nodeType = 'character_extraction'; section.dataset.status = dataState.status
    head.append(element('h3', '角色'), element('span', labels[dataState.status] || '未生成', 'node-data-tag'))
    if (rows.length) head.append(element('span', `${rows.length} 位角色`, 'production-count'))
    section.append(head)
    const ui = element('div', '', 'node-ui'), buttons = element('div', '', 'node-ui-buttons'), records = element('nav', '', 'node-ui-records'), actions = element('div', '', 'node-ui-execution')
    records.setAttribute('aria-label', '角色记录与规则')
    if (openTasks) records.append(button('任务历史', () => openTasks('character_extraction', '角色')))
    if (openRules) records.append(button('查看规则', () => openRules('character_extraction', '角色')))
    if (rows.length) records.append(button('复制角色', async () => {
      try { await root.ownerDocument.defaultView.navigator.clipboard.writeText(readable({ segments: rows })); showToast('已复制') }
      catch { showToast('复制失败，请重试') }
    }))
    const input = element('input', '', 'node-ui-opinion'), error = element('p', local.error || '', 'error node-ui-failure')
    input.placeholder = '本次执行意见'; input.setAttribute('aria-label', '角色本次执行意见')
    state.nodeOpinions ||= {}
    input.value = state.nodeOpinions.character_extraction ?? node.node_state.opinion ?? ''
    input.oninput = () => { state.nodeOpinions.character_extraction = input.value }
    let saved = node.node_state.opinion || '', chain = Promise.resolve()
    input.onblur = () => {
      const value = input.value
      chain = chain.then(async () => {
        if (!saveOpinion || value === saved) return
        error.textContent = ''; input.setAttribute('aria-busy', 'true')
        try { await saveOpinion('character_extraction', value, saved); saved = value }
        catch (failure) { error.textContent = failure.message }
        finally { input.removeAttribute('aria-busy') }
      })
    }
    const run = button(rows.length ? '按意见修改' : 'AI生成', async () => {
      if (run.disabled || local.submitting || !characters.isCurrent?.()) return
      const instruction = input.value.trim() || (rows.length ? '按项目规则修改角色' : '按当前故事大纲提取完整角色')
      local.submitting = true; local.error = ''; local.nodeBefore = structuredClone(node.node_state)
      if (local.request?.instruction !== instruction) local.request = { instruction, id: root.ownerDocument.defaultView.crypto.randomUUID() }
      characters.repaint()
      try {
        await chain
        const result = await characters.generate(instruction, local.request.id)
        if (!characters.isCurrent()) return
        characters.setExecution({ group_id: result.group_id, status: result.status, node_state_before: local.nodeBefore })
        local.request = null
        characters.refresh?.()
      } catch (failure) { if (characters.isCurrent()) local.error = failure.message }
      finally { local.submitting = false; if (characters.isCurrent()) characters.repaint() }
    })
    run.disabled = busy || !characters.generate || !project.story_segments.segments.length
    run.title = !project.story_segments.segments.length ? '请先生成故事大纲' : busy ? '角色任务正在执行' : '仅生成或修改角色'
    actions.append(run); buttons.append(records, actions); ui.append(buttons, input, error)
    error.setAttribute('role', 'status')
    if (busy) {
      const step = active?.step, issues = active?.review_issues || [], repairing = step?.kind === 'revise' && issues.length > 0
      const phase = { generate: '生成', review: '审核', revise: repairing ? '修订' : '生成' }[step?.kind]
      const progress = !active ? '正在提交角色任务…' : active.status === 'queued' ? '排队中，等待执行…'
        : phase ? `正在${phase}角色，等待模型返回…` : '正在执行角色任务…'
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
    if (!rows.length) section.append(element('p', '暂无角色', 'production-empty'))
    renderImageBatch(section, project, { state, images, busy: busy || images.execution, repaint: characters.repaint })
    rows.forEach((row, index) => {
      const card = element('article', '', 'production-card')
      card.append(element('h4', `${index + 1}. ${row.name}`))
      card.append(element('p', readable(row), 'production-text character-details'))
      renderCostumeImages(card, row, project, { state, images, busy: busy || images.execution, repaint: characters.repaint })
      section.append(card)
    })
    root.append(section)
  },
}
