import { panel as groupPanel } from '../../../group_setting/ui/panel/index.js'
import { element } from '../../../../client/ui/panel-dom.js'
import { renderCostumeImages, renderImageBatch } from '../../../costume_image/ui/panel/index.js'
import { readable } from '../../../../client/ui/readable.js'
import { showToast } from '@agent-modules/ui'

const labels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.onclick = action; return node }

export const panel = {
  type: 'character_extraction', key: 'character_extraction', title: '角色',
  render(root, project, { state, openTasks, openRules, saveOpinion, groups: groupOperation = {}, characters = {}, images = {} }) {
    const groups = project.group_setting?.groups || project.character_extraction.groups || []
    groupPanel.render(root, project, { state, openTasks, openRules, saveOpinion, groups: groupOperation,
      otherBusy: !!characters.execution || !!images.execution || !!state.characterUi?.submitting || !!state.imageSubmitting })
    const node = project.character_extraction, rows = node.characters, hasRows = rows.length, local = state.characterUi ||= {}
    const incoming = ['queued', 'running'].includes(characters.execution?.status) ? characters.execution : null
    if (!incoming || incoming.group_id !== local.runningExecution?.group_id) local.runningExecution = null
    if (incoming?.status === 'running') local.runningExecution = structuredClone(incoming)
    const active = incoming?.status === 'queued' && local.runningExecution?.group_id === incoming.group_id ? local.runningExecution : incoming
    const busy = !!active || !!local.submitting
    const dataState = busy ? active?.node_state_before || local.nodeBefore || node.node_state : node.node_state
    const section = element('section', '', 'production-section script-node role-module-card'), head = element('div', '', 'section-head')
    section.dataset.roleModule = 'characters'; section.dataset.nodeType = 'character_extraction'; section.dataset.status = dataState.status
    head.append(element('h3', '人物提取'), element('span', labels[dataState.status] || '未生成', 'node-data-tag'))
    if (hasRows) head.append(element('span', `${rows.length} 位人物`, 'production-count'))
    section.append(head)
    const ui = element('div', '', 'node-ui'), buttons = element('div', '', 'node-ui-buttons'), records = element('nav', '', 'node-ui-records'), actions = element('div', '', 'node-ui-execution')
    records.setAttribute('aria-label', '角色记录与规则')
    if (openTasks) records.append(button('任务历史', () => openTasks('character_extraction', '角色')))
    if (openRules) records.append(button('查看规则', () => openRules('character_extraction', '角色')))
    if (hasRows) records.append(button('复制人物资料', async () => {
      try { await root.ownerDocument.defaultView.navigator.clipboard.writeText(readable({ characters: rows })); showToast('已复制') }
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
    const submit = async (control, regenerate = false) => {
      if (control.disabled || local.submitting || !characters.isCurrent?.()) return
      const instruction = regenerate ? `按当前故事大纲、已确认团队和最新项目规则重新提取人物与个人服装，旧资料仅供复用仍适用的稳定ID，不作为必须保留的基稿。` : input.value.trim() || (hasRows ? '按项目规则修改人物资料与个人服装设定' : '按当前故事大纲和已确认团队提取完整人物并补齐个人服装设定')
      local.submitting = true; local.error = ''; local.nodeBefore = structuredClone(node.node_state)
      if (local.request?.instruction !== instruction || local.request?.regenerate !== regenerate) local.request = { instruction, regenerate, id: root.ownerDocument.defaultView.crypto.randomUUID() }
      characters.repaint()
      try {
        await chain
        const result = await characters.generate(instruction, local.request.id, ...(regenerate ? [{ regenerate: true }] : []))
        if (!characters.isCurrent()) return
        characters.setExecution({ group_id: result.group_id, status: result.status, node_state_before: local.nodeBefore })
        local.request = null
        characters.refresh?.()
      } catch (failure) { if (characters.isCurrent()) local.error = failure.message }
      finally { local.submitting = false; if (characters.isCurrent()) characters.repaint() }
    }
    const run = button(hasRows ? '按意见修改' : '提取人物', () => submit(run))
    const regenerate = button('重新生成', () => submit(regenerate, true))
    run.disabled = regenerate.disabled = busy || !!groupOperation.execution || !!state.groupUi?.submitting || project.group_setting?.node_state.status !== 'generated' || !characters.generate || !project.story_segments.segments.length
    run.title = !project.story_segments.segments.length ? '请先生成故事大纲' : project.group_setting?.node_state.status !== 'generated' ? '请先完成团队设定；无团队也需审核空集合' : busy ? '角色任务正在执行' : '仅生成或修改人物'
    regenerate.title = '按当前资料和项目规则重新生成'
    if (hasRows) actions.append(regenerate)
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
    const groupName = id => groups.find(group => group.id === id)?.name || id
    if (!rows.length) section.append(element('p', '暂无人物资料', 'production-empty'))
    rows.forEach((row, index) => {
      const card = element('article', '', 'production-card')
      const { costumes = [], ...details } = row
      const outfits = costumes.map(costume => {
        const uniform = groups.find(group => group.id === costume.group_id)?.costumes?.find(item => item.id === costume.group_costume_id)
        const description = [...new Set([uniform?.description, costume.description].filter(value => value?.trim()))].join('；')
        return { name: costume.name, description }
      })
      card.append(element('h4', `${index + 1}. ${row.name}`), element('p', readable({ ...details,
        group_ids: (row.group_ids || []).map(groupName), costumes: outfits.length ? outfits : '暂无服装设定',
      }), 'production-text character-details'))
      section.append(card)
    })
    root.append(section)
    const portraits = renderImageBatch(root, project, { state, images, busy: busy || groupOperation.execution || state.groupUi?.submitting || images.execution, repaint: characters.repaint })
    portraits.classList.add('role-module-card'); portraits.dataset.roleModule = 'portraits'
    if (!rows.length) portraits.append(element('p', '人物资料生成后，可按人物及服装生成定妆照。', 'production-empty'))
    for (const row of rows) {
      const card = element('article', '', 'production-card character-portraits')
      card.append(element('h4', row.name))
      renderCostumeImages(card, row, project, { state, images, busy: busy || groupOperation.execution || state.groupUi?.submitting || images.execution, repaint: characters.repaint })
      portraits.append(card)
    }
  },
}
