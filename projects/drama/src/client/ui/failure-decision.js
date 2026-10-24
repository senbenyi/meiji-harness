/** 盒子失败是执行结论；结果保存与用户下一步选择分别展示。 */
export function createFailureDecision(document, { group, decision, onDecision, onDetails }) {
  const host = document.createElement('drama-failure-decision'), root = host.attachShadow({ mode: 'open' })
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el }
  const style = node('style', `:host{display:block;margin:14px 0;color:var(--dsw-alias-label-primary,#17191f);font:14px/1.65 system-ui}*{box-sizing:border-box}.card{border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);padding:16px 18px}.head,.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.head{justify-content:space-between}.name{font-weight:600}.badge{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b)}h3{font-size:16px;margin:9px 0}p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.muted,.reason{color:var(--dsw-alias-label-secondary,#61666b)}.saved{font-size:13px}.actions{margin-top:16px}button{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:8px;padding:7px 13px;background:transparent;color:inherit}button.primary{background:var(--dsw-alias-state-business-primary,#4176e6);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}button:disabled{opacity:.5;cursor:wait}.details{margin-left:auto;font-size:12px}.hint{font-size:13px;color:var(--dsw-alias-label-secondary,#61666b)}@media(max-width:500px){.details{margin-left:0}}`)
  const card = node('section', null, 'card'); card.setAttribute('aria-label', '节点失败处理')
  const head = node('div', null, 'head'), badge = node('span', decision ? '已处理' : '等待你的选择', 'badge')
  head.append(node('span', `${group.name} · 执行结果`, 'name'), badge)
  card.append(head, node('h3', group.status === 'rejected' ? '审核未通过，需要你决定下一步' : '执行失败，需要你处理'))
  const cause = { content_issue: '内容问题', upstream_issue: '上游资料问题', rule_conflict: '规则冲突', failed: '执行错误' }[group.context.decision]
  if (cause) card.append(node('p', `原因类型：${cause}`, 'cause'))
  const saved = group.context.saved
  card.append(node('p', saved ? '最新有效结果已自动保存。审核未通过不影响结果保存。' : '本次没有已确认的项目保存结果，已有结果仍保留。', 'saved'))
  card.append(node('p', group.context.stop_reason || group.context.reason || '执行已停止。', 'reason'))
  const progress = [group.context.stopped_at, group.context.duration_seconds != null ? `用时 ${group.context.duration_seconds} 秒` : ''].filter(Boolean).join(' · ')
  if (progress) card.append(node('p', progress, 'muted'))
  const hint = node('p', decision || (group.context.requires_user_decision ? '自动修订已停止。继续修改会沿用最后结果和审核意见；重新生成会读取当前项目资料。' : '请查看任务详情，确认需要处理的问题。'), 'hint')
  hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite'); card.append(hint)
  const actions = node('div', null, 'actions'), controls = []
  if (!decision && onDecision) for (const [action, label] of group.context.requires_user_decision ? [...(group.context.can_continue ?? saved ? [['continue', '继续修改']] : []), ['stop', '停止'], ['regenerate', '重新生成']] : [['stop', '停止']]) {
    const control = node('button', label, action === 'continue' ? 'primary' : ''); control.type = 'button'
    control.onclick = async () => {
      controls.forEach(button => { button.disabled = true })
      try {
        const text = await onDecision(action)
        hint.textContent = text; badge.textContent = action === 'stop' ? '已停止' : '已提交'
        controls.forEach(button => button.remove())
      } catch (error) {
        hint.textContent = `${error.message || '提交失败'}，可重试。`
        controls.forEach(button => { button.disabled = false })
      }
    }
    controls.push(control); actions.append(control)
  }
  const details = node('button', '任务详情', 'details'); details.type = 'button'
  details.onclick = async () => { details.disabled = true; try { await onDetails() } catch (error) { hint.textContent = error.message || '任务详情读取失败' } finally { details.disabled = false } }
  actions.append(details); card.append(actions); root.append(style, card)
  return host
}
