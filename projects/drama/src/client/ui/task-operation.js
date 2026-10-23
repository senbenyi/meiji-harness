import { showToast } from '@agent-modules/ui'
import { nodeUi } from './node-registry.js'
import { createFailureDecision } from './failure-decision.js'

const labels = { queued: '排队中', running: '执行中', completed: '已完成', rejected: '未通过', failed: '执行失败', cancelled: '已取消' }

export function groupTaskMessages(messages) {
  const groups = new Map()
  for (const message of messages) {
    const key = message.group_id || message.id
    if (!groups.has(key)) groups.set(key, { id: key, messages: [] })
    groups.get(key).messages.push(message)
  }
  return [...groups.values()].map(group => {
    const start = group.messages.find(message => message.phase === 'start'), result = group.messages.findLast(message => message.phase === 'result')
    const latest = group.messages.at(-1), context = result || latest
    const status = latest.operation_status || result?.status || (latest.phase ? 'running' : latest.status)
    return { ...group, start, result, context, status, steps: group.messages.filter(message => message.phase === 'step').sort((a, b) => a.seq - b.seq),
      name: context.operation_name || start?.title?.replace(/^面板操作：/, '') || latest.title || '任务',
      goal: start?.goal || latest.goal || '' }
  })
}

const css = `:host{display:block;min-width:0;color:var(--dsw-alias-label-primary,#17191f);font:14px/1.65 system-ui}*{box-sizing:border-box}.operation{padding:12px 0 20px}.request{margin:0 0 10px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1,#f6f7f9);border:1px solid var(--dsw-alias-border-l3,#e6e8ec);border-radius:12px}.eyebrow,.muted{font-size:12px;color:var(--dsw-alias-label-secondary,#737780)}.request h3{font-size:14px;margin:3px 0;font-weight:600}.request .meta{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.request .input-summary{font-size:12px;color:var(--dsw-alias-label-secondary,#737780)}.request>details>summary{padding:2px 0;font-size:12px}.request p{margin:4px 0}.goal{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}summary{display:flex;gap:8px;align-items:baseline;cursor:pointer;list-style:none;min-width:0;padding:5px 0;color:var(--dsw-alias-label-secondary,#737780)}summary::-webkit-details-marker{display:none}summary:before{content:'›';flex:none}details[open]>summary:before{transform:rotate(90deg)}.line{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.body{padding:8px 0 8px 16px}.step{border-left:1px solid var(--dsw-alias-border-l3,#ddd);padding-left:12px}.badge{flex:none;font-size:12px}.error{color:var(--dsw-alias-state-error-primary,#dc2626)}.success{color:var(--dsw-alias-state-success-primary,#258454)}.execution-status{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--dsw-alias-label-secondary,#737780)}.execution-spinner{display:inline-block;width:12px;height:12px;flex:0 0 12px;padding:0;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:drama-executing .9s linear infinite}.execution-dot{width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:currentColor}@keyframes drama-executing{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.execution-spinner{animation:none}}.outcome{margin-top:12px}.outcome strong{font-size:15px}.outcome p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}button{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:7px;padding:4px 10px;cursor:pointer}button:hover{background:var(--dsw-alias-bg-layer-1,#f6f7f9)}button:disabled{opacity:.6;cursor:wait}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:340px;overflow:auto;font:12px/1.6 ui-monospace,monospace;margin:8px 0}h4{font-size:13px;margin:10px 0 4px}.payload{border-top:1px solid var(--dsw-alias-border-l3,#eee);margin-top:8px}dialog{width:min(960px,calc(100vw - 48px));max-height:85vh;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:14px;color:var(--dsw-alias-label-primary,#17191f);background:var(--dsw-alias-bg-base,#fff);padding:20px}dialog::backdrop{background:#0005}.dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.dialog-head h3{margin:0}.compare{display:grid;grid-template-columns:1fr 1fr;gap:20px}.compare pre{max-height:60vh}mark{color:inherit;background:#ffd86b66}@media(max-width:640px){.compare{grid-template-columns:1fr}.request{padding:8px 10px}}`

/** 空会话与正常会话共用容器；节点内容经注册模块展示，展开优先使用预载快照。 */
export function createTaskOperation(document, { loadMessage, getMessage, copy, loadHistory, onDecision, onNotify = showToast }) {
  const element = document.createElement('drama-task-operation'), root = element.attachShadow({ mode: 'open' })
  const style = document.createElement('style'); style.textContent = css
  const content = document.createElement('div'); content.className = 'operation'
  root.append(style, content)
  let group, signature, generation = 0, processTouched = false
  let renderer = {}
  const cache = new Map(), decisions = new Map()
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el }
  const button = (text, action) => { const el = node('button', text); el.type = 'button'; el.onclick = async () => { el.disabled = true; try { await action() } catch (error) { el.textContent = error.message || '读取失败，点击重试' } finally { el.disabled = false } }; return el }
  const copyControl = (label, read) => {
    const control = node('button', label); control.type = 'button'
    control.onclick = async () => {
      try { await copy(read()); onNotify('已复制') }
      catch { onNotify('复制失败，请重试') }
    }
    return control
  }
  const get = async message => {
    const available = getMessage?.(message.id)
    if (available) return available
    if (cache.has(message.id)) return cache.get(message.id)
    const data = await loadMessage(message.id)
    if (!data) throw new Error('记录暂不可用，点击重试')
    cache.set(message.id, data); return data
  }
  const payload = (container, title, value) => {
    const section = node('section', undefined, 'payload'), pre = node('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    const copyButton = copyControl(`复制${title}`, () => pre.textContent)
    section.append(node('h4', title), pre, copyButton)
    container.append(section)
  }
  const disclosure = (key, caption, expanded = false) => {
    const details = node('details'), summary = node('summary'), body = node('div', undefined, 'body')
    details.dataset.expand = key; details.open = expanded; summary.append(node('span', caption, 'line')); details.append(summary, body)
    return { details, summary, body }
  }
  const inputContent = (body, data, title) => {
    if (!data) { body.append(node('p', '这次记录未保存可读取的输入。', 'muted')); return }
    renderer.renderInput?.(body, data, tools)
    if (data.output_language) body.append(node('p', `输出语言：${data.output_language}`, 'muted'))
    if (data.review_issues?.length) {
      body.append(node('h4', '本轮审核意见'))
      for (const issue of data.review_issues) body.append(node('p', [issue.reason, issue.suggestion].filter(Boolean).join('；')))
    }
    const record = disclosure(`${title}-record`, '完整输入记录')
    payload(record.body, title, data); body.append(record.details)
    const copyInput = copyControl(`复制${title}`, () => JSON.stringify(data, null, 2))
    body.append(copyInput)
  }
  const outputContent = (body, result) => {
    renderer.renderStepOutput?.(body, result, tools)
    if (result?.review) {
      body.append(node('h4', `审核结论：${result.review.status === 'passed' ? '通过' : '未通过'}`))
      for (const issue of result.review.issues || []) body.append(node('p', [issue.reason, issue.suggestion].filter(Boolean).join('；')))
    }
    const record = disclosure('output-record', '完整输出记录'); payload(record.body, '步骤输出', result); body.append(record.details)
  }
  const lazy = (item, message, render) => {
    let loaded = false, loading = false
    const ticket = generation
    const load = async () => {
      if (!item.details.open || loaded || loading) return
      const available = getMessage?.(message.id)
      if (available) { item.body.replaceChildren(); render(item.body, available); loaded = true; return }
      loading = true; item.body.replaceChildren(node('span', '正在读取当次记录…', 'muted'))
      try {
        const data = await get(message)
        if (ticket !== generation) return
        item.body.replaceChildren(); render(item.body, data); loaded = true
      } catch (error) {
        if (ticket !== generation) return
        item.body.replaceChildren(node('p', error.message, 'error'), button('重试', load))
      } finally { loading = false }
    }
    item.details.ontoggle = load
    item.summary.addEventListener('click', () => {
      if (!item.details.open) {
        const available = getMessage?.(message.id)
        if (available && !loaded) { item.body.replaceChildren(); render(item.body, available); loaded = true }
      }
    })
    if (item.details.open) void load()
  }
  const modal = (title, build) => {
    const dialog = node('dialog'), head = node('div', undefined, 'dialog-head')
    head.append(node('h3', title), button('关闭', () => dialog.remove())); dialog.append(head)
    build(dialog); root.append(dialog)
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '')
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
  }
  const tools = { node, button, payload, get, modal, document }
  return { element, update(next) {
    const nextSignature = JSON.stringify(next)
    if (nextSignature === signature) return
    const previousStatus = group?.status
    const opened = new Map([...content.querySelectorAll('details[data-expand]')].map(el => [el.dataset.expand, el.open]))
    group = next; signature = nextSignature; generation++
    renderer = nodeUi(group.context.node_type).conversation || {}
    const fragment = document.createDocumentFragment()
    const request = node('section', undefined, 'request')
    const meta = node('div', undefined, 'meta')
    meta.append(node('span', `${group.context.source === 'conversation' ? '会话执行' : '面板操作'} · ${group.name}`, 'eyebrow'))
    const description = (group.start || group.context).box_input_description || (group.start || group.context).input_description
    if (description) meta.append(node('span', `输入：${description.origin}${description.project_name ? ` ·《${description.project_name}》` : ''}${description.characters !== undefined ? ` · ${description.characters}字` : ''}`, 'input-summary'))
    request.append(meta, node('h3', group.goal || group.name))
    const reference = group.start || group.messages[0]
    const input = disclosure('box-input', '查看本次输入', opened.get('box-input'))
    lazy(input, reference, (body, data) => {
      if (data.box_input || data.input) inputContent(body, data.box_input || data.input, '盒子输入')
      else body.append(node('p', '这次旧记录未保存输入快照。', 'muted'))
      if (data.rules) { const rules = disclosure('box-rules', '本次规则'); payload(rules.body, '规则', data.rules); body.append(rules.details) }
    })
    request.append(input.details); fragment.append(request)
    if (group.steps.length || ['queued', 'running'].includes(group.status)) {
      const revisions = group.context.revision_count ?? group.steps.filter(step => step.round > 0 && step.step_name?.includes('修改') && step.status === 'done').length
      const caption = ['执行过程', `${group.steps.length} 个已结束步骤`, revisions ? `自动修订 ${revisions} 次` : '', ['queued', 'running'].includes(group.status) ? '' : labels[group.status] || ''].filter(Boolean).join(' · ')
      const defaultOpen = ['queued', 'running'].includes(group.status)
      const process = disclosure('process', caption, previousStatus === 'running' && !defaultOpen && !processTouched ? false : opened.get('process') ?? defaultOpen)
      process.summary.onclick = () => { processTouched = true }
      for (const step of group.steps) {
        const resolved = step.status === 'rejected' && group.steps.some(later => later.seq > step.seq && later.status === 'done' && (later.step_name?.includes('审核') || later.result?.review?.status === 'passed'))
        const item = disclosure(`step:${step.id}`, `${step.seq}. ${step.step_name || step.title}${step.round ? `（修订${step.round}）` : ''}`, opened.get(`step:${step.id}`))
        item.details.className = 'step'
        item.summary.append(node('span', `${step.label}${resolved ? ' · 已解决' : ''}`, `badge ${['rejected', 'failed'].includes(step.status) ? 'error' : ''}`))
        if (step.issue_summary || (['failed', 'rejected'].includes(step.status) && step.reason)) item.summary.append(node('span', step.issue_summary || step.reason, 'line muted'))
        lazy(item, step, (body, data) => {
          if (data.reason) body.append(node('p', data.reason))
          if (data.input !== null && data.input !== undefined) inputContent(body, data.input, '步骤输入')
          else body.append(node('p', '该步骤未保存可读取的输入。', 'muted'))
          if (Object.hasOwn(data, 'result')) outputContent(body, data.result)
        })
        process.body.append(item.details)
      }
      fragment.append(process.details)
    }
    const terminal = !['queued', 'running'].includes(group.status)
    if (!terminal) {
      const status = node('div', undefined, 'execution-status')
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
      const running = group.status === 'running'
      const indicator = node('span', undefined, running ? 'execution-spinner' : 'execution-dot')
      indicator.setAttribute('aria-hidden', 'true')
      const active = group.context.active_step
      status.append(indicator, node('span', running ? active?.name ? `正在执行：${active.name}` : '正在执行中…' : '等待执行…'))
      fragment.append(status)
    }
    if (terminal && ['rejected', 'failed'].includes(group.status)) {
      const owner = group
      fragment.append(createFailureDecision(document, { group, decision: decisions.get(group.id),
        onDecision: onDecision ? async action => {
          await onDecision(owner, action)
          const text = action === 'stop' ? '已停止后续处理，已保存结果保留。' : action === 'continue' ? '已提交继续修改，等待新任务结果。' : '已提交重新生成，等待新任务结果。'
          decisions.set(owner.id, text); return text
        } : undefined,
        onDetails: async () => { const detail = await loadHistory(owner.id); modal('本次任务记录', body => payload(body, '任务记录', detail)) },
      }))
      const actions = node('div', undefined, 'actions')
      renderer.appendActions?.(actions, group, group.result || group.messages.at(-1), tools)
      if (actions.childElementCount) fragment.append(actions)
    } else if (terminal) {
      const outcome = node('section', undefined, 'outcome')
      const saved = group.context.saved
      const presentation = renderer.outcome?.(group) || {}
      const success = group.status === 'completed'
      const headline = success ? presentation.headline || (saved ? '操作完成，已保存' : '操作已完成') : labels[group.status] || group.context.label
      outcome.append(node('strong', headline, success ? 'success' : group.status === 'cancelled' ? '' : 'error'))
      if (success) outcome.append(node('p', presentation.description || '操作结果已记录。'))
      else {
        outcome.append(node('p', group.context.stop_reason || group.context.reason || '执行已停止。'))
        if (group.context.stopped_at) outcome.append(node('p', `结束步骤：${group.context.stopped_at}`, 'muted'))
        if (presentation.retained) outcome.append(node('p', presentation.retained, 'muted'))
      }
      if (group.context.duration_seconds !== null && group.context.duration_seconds !== undefined) outcome.append(node('p', `用时 ${group.context.duration_seconds} 秒`, 'muted'))
      const actions = node('div', undefined, 'actions')
      const finalReference = group.result || group.messages.at(-1)
      renderer.appendActions?.(actions, group, finalReference, tools)
      if (group.context.group_id) actions.append(button('任务详情', async () => { const detail = await loadHistory(group.id); modal('本次任务记录', body => payload(body, '任务记录', detail)) }))
      if (actions.childElementCount) outcome.append(actions)
      fragment.append(outcome)
    }
    if (!group.steps.length && !group.start && !group.context.phase) {
      const legacy = disclosure('legacy', '查看旧记录', opened.get('legacy')); legacy.body.append(node('p', group.context.reason || '')); fragment.append(legacy.details)
    }
    content.replaceChildren(fragment)
  }, dispose() { generation++; element.remove() } }
}
