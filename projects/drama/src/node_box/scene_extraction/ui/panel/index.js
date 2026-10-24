import { renderSceneImage } from '../../../scene_image/ui/panel/index.js'
import { element } from '../../../../client/ui/panel-dom.js'
import { readable } from '../../../../client/ui/readable.js'
import { showToast } from '@agent-modules/ui'

const labels = { empty: '未生成', generated: '已生成', rejected: '未通过', expired: '已过期' }
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.onclick = action; return node }

export const panel = {
  type: 'scene_extraction', key: 'scene_extraction', title: '场景',
  render(root, project, { state, openTasks, openRules, saveOpinion, scenes: operation = {}, sceneImages = {}, otherBusy = false }) {
    const node = project.scene_extraction, rows = node.scenes, hasRows = rows.length, local = state.sceneUi ||= {}
    const incoming = ['queued', 'running'].includes(operation.execution?.status) ? operation.execution : null
    if (!incoming || incoming.group_id !== local.runningExecution?.group_id) local.runningExecution = null
    if (incoming?.status === 'running') local.runningExecution = structuredClone(incoming)
    const active = incoming?.status === 'queued' && local.runningExecution?.group_id === incoming.group_id ? local.runningExecution : incoming
    const busy = !!active || !!local.submitting
    const dataState = busy ? active?.node_state_before || local.nodeBefore || node.node_state : node.node_state
    const section = element('section', '', 'production-section script-node'), head = element('div', '', 'section-head')
    section.dataset.nodeType = 'scene_extraction'; section.dataset.status = dataState.status
    head.append(element('h3', '场景提取'), element('span', labels[dataState.status] || '未生成', 'node-data-tag'))
    if (hasRows) head.append(element('span', `${rows.length} 个场景`, 'production-count'))
    section.append(head)
    const ui = element('div', '', 'node-ui'), buttons = element('div', '', 'node-ui-buttons'), records = element('nav', '', 'node-ui-records'), actions = element('div', '', 'node-ui-execution')
    records.setAttribute('aria-label', '场景记录与规则')
    if (openTasks) records.append(button('任务历史', () => openTasks('scene_extraction', '场景')))
    if (openRules) records.append(button('查看规则', () => openRules('scene_extraction', '场景')))
    if (hasRows) records.append(button('复制场景资料', async () => {
      try { await root.ownerDocument.defaultView.navigator.clipboard.writeText(readable({ scenes: rows })); showToast('已复制') }
      catch { showToast('复制失败，请重试') }
    }))
    const input = element('input', '', 'node-ui-opinion'), error = element('p', local.error || '', 'error node-ui-failure')
    input.placeholder = '本次执行意见'; input.setAttribute('aria-label', '场景本次执行意见')
    state.nodeOpinions ||= {}
    input.value = state.nodeOpinions.scene_extraction ?? node.node_state.opinion ?? ''
    input.oninput = () => { state.nodeOpinions.scene_extraction = input.value }
    let saved = node.node_state.opinion || '', chain = Promise.resolve()
    input.onblur = () => {
      const value = input.value
      chain = chain.then(async () => {
        if (!saveOpinion || value === saved) return
        error.textContent = ''; input.setAttribute('aria-busy', 'true')
        try { await saveOpinion('scene_extraction', value, saved); saved = value }
        catch (failure) { error.textContent = failure.message }
        finally { input.removeAttribute('aria-busy') }
      })
    }
    const submit = async (control, regenerate = false) => {
      if (control.disabled || local.submitting || !operation.isCurrent?.()) return
      const instruction = regenerate ? `按当前故事大纲和最新项目规则重新生成完整场景资料，现有场景仅用于复用仍适用的稳定ID和名称，不作为必须保留的内容基稿。${input.value.trim() ? `本次要求：${input.value.trim()}` : ''}` : input.value.trim() || (hasRows ? '按项目规则修改场景固定资料' : '按当前故事大纲提取完整场景并补齐适合年代、用途与剧情的固定空间、材质、光源及通路')
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
    const run = button(hasRows ? '按意见修改' : '提取场景', () => submit(run))
    const regenerate = button('重新生成', () => submit(regenerate, true))
    run.disabled = regenerate.disabled = busy || !!sceneImages.execution || !!state.sceneImageSubmitting || otherBusy || !operation.generate || !project.story_segments.segments.length
    run.title = !project.story_segments.segments.length ? '请先生成故事大纲' : busy ? '场景任务正在执行' : '仅生成或修改场景'
    regenerate.title = '按当前故事大纲和项目规则重新生成场景资料'
    if (hasRows) actions.append(regenerate)
    actions.append(run); buttons.append(records, actions); ui.append(buttons, input, error)
    error.setAttribute('role', 'status')
    if (busy) {
      const step = active?.step, issues = active?.review_issues || [], repairing = step?.kind === 'revise' && issues.length > 0
      const phase = { generate: '生成', review: '审核', revise: repairing ? '修订' : '生成' }[step?.kind]
      const progress = !active ? '正在提交场景任务…' : active.status === 'queued' ? '排队中，等待执行…'
        : phase ? `正在${phase}场景，等待模型返回…` : '正在执行场景任务…'
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
    if (!rows.length) section.append(element('p', dataState.status === 'generated' ? '已确认当前故事没有需要固定建档的场景。' : '暂无场景；可按故事大纲独立提取。', 'production-empty'))
    for (const [index, scene] of rows.entries()) {
      const card = element('article', '', 'production-card scene-details')
      card.append(element('h4', `${index + 1}. ${scene.name}`), element('p', readable(scene), 'production-text'))
      renderSceneImage(card, scene, project, { state, sceneImages, busy: busy || otherBusy })
      section.append(card)
    }
    root.append(section)
  },
}
