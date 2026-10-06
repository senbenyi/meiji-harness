import { element, appendJsonCopy } from './panel-dom.js'
import { targetLabel, stepKindLabels, stepLabel, skillsLine } from './run-labels.js'
import { runDisplayStatus, runStepStatusLabels, runGoalLabel, runTargetMatches } from '../shared/run-view.js'
import { outlineText } from '../shared/story-outline.js'

const time = value => value ? new Date(value).toLocaleString() : '—'
const kindLabels = { ...stepKindLabels, manual_edit: '人工编辑', image: '生成图片', wait_confirm: '等待图片确认', wait_script_confirm: '等待剧本确认', storyboard: '文本分镜', video: '生成视频', tail: '提取尾帧', sync: '回写剧本', expand: '展开镜头' }
const originLabels = { plan: '计划', 'review-fail': '审核反馈', manual: '人工', 'user-feedback': '用户反馈' }

async function copyText(value, button, message) {
  try {
    if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前环境不支持复制')
    await globalThis.navigator.clipboard.writeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    const original = button.textContent
    button.textContent = '已复制'
    setTimeout(() => { button.textContent = original }, 1200)
  } catch (error) { message.textContent = `复制失败：${error.message}` }
}

export function renderRunDetail(project, { load, back, loadRecords, target = '' }) {
  const view = element('section', '', 'task-history-page run-detail-page')
  const header = element('div', '', 'task-history-header'), returnButton = element('button', '← 返回'), title = element('h2', '任务详情'), runStatus = element('span', '', 'task-history-status run-detail-status')
  returnButton.onclick = back; header.append(returnButton, title, runStatus)
  const message = element('p', '', 'error'), body = element('div')
  view.append(header, message, body)
  let run, requestId = 0, returnAction = back

  const copyButton = (label, value) => {
    const button = element('button', label, 'run-copy-button')
    button.onclick = () => copyText(value, button, message)
    return button
  }

  const draw = () => {
    returnAction = back; returnButton.textContent = '← 返回'
    const expanded = new Set([...body.querySelectorAll('details[data-step-id][open]')].map(node => node.dataset.stepId))
    body.replaceChildren()
    title.textContent = runGoalLabel(run, project)
    const displayStatus = runDisplayStatus(run)
    runStatus.textContent = displayStatus.label
    runStatus.className = `task-history-status run-detail-status is-${displayStatus.key}`
    body.append(element('p', `${displayStatus.label} · ${run.initiator === 'session' ? '会话发起' : '面板发起'} · ${time(run.startedAt || run.createdAt)} - ${time(run.endedAt)}`, 'meta run-detail-meta'))

    if (run.pause?.reasons?.length) {
      const reasons = element('section', '', 'run-readonly-reasons')
      reasons.append(element('h3', '处理原因'))
      for (const reason of run.pause.reasons) {
        const row = element('div', '', 'run-readonly-reason'), text = reason.message || reason.code || '任务需要处理'
        row.append(element('p', text), copyButton('复制', text)); reasons.append(row)
      }
      body.append(reasons)
    }

    const steps = [...(run.steps || [])].sort((a, b) => String(a.startedAt || a.createdAt || '\uffff').localeCompare(String(b.startedAt || b.createdAt || '\uffff')))
    const stepList = element('ol', '', 'run-step-list')
    for (const [index, step] of steps.entries()) {
        const failed = step.status === 'failed' || step.output?.passed === false || Boolean(step.error)
        const item = element('details', '', `run-step-card is-${step.status}`); item.dataset.stepId = step.id; item.open = expanded.has(step.id) || failed
        item.dataset.stepNumber = String(index + 1); item.dataset.target = step.target || ''
        if (target && runTargetMatches(step.target, target)) { item.classList.add('is-highlighted'); item.setAttribute('aria-label', '当前对象') }
        const summary = element('summary', '', 'run-step-summary')
        const expandState = element('span', item.open ? '收起详情' : '展开详情', 'run-step-expand-state')
        expandState.setAttribute('aria-label', item.open ? '当前已展开' : '当前已收起')
        item.addEventListener('toggle', () => {
          expandState.textContent = item.open ? '收起详情' : '展开详情'
          expandState.setAttribute('aria-label', item.open ? '当前已展开' : '当前已收起')
        })
        const heading = element('div', '', 'run-step-heading')
        heading.append(element('span', runStepStatusLabels[step.status] || step.status, `task-history-status is-${step.status}`), element('strong', `${index + 1}. ${stepLabel(step)}${step.round ? ` · 第 ${step.round} 轮` : ''}`))
        if (step.output?.passed !== undefined) heading.append(element('span', step.output.passed ? '审核通过' : '审核未通过', `task-history-status run-step-verdict-badge is-${step.output.passed ? 'passed' : 'failed'}`))
        heading.append(expandState)
        summary.append(heading, element('span', `${time(step.startedAt)} - ${time(step.endedAt)}`, 'meta run-step-time'))
        const promptActions = element('span', '', 'run-step-summary-actions')
        if (step.prompts?.length) {
          const open = element('button', '查看提示词')
          open.onclick = event => { event.preventDefault(); event.stopPropagation(); void openRecordPage(step, 'prompts') }
          promptActions.append(open)
        }
        if (step.responses?.length) {
          const open = element('button', '查看 HTTP 请求')
          open.onclick = event => { event.preventDefault(); event.stopPropagation(); void openRecordPage(step, 'responses') }
          promptActions.append(open)
        }
        let snapshotButton = null
        if (step.artifacts?.length) {
          snapshotButton = element('button', '查看生成快照')
          snapshotButton.onclick = event => { event.preventDefault(); event.stopPropagation(); void openRecordPage(step, 'artifacts') }
          promptActions.append(snapshotButton)
        }
        item.append(summary)
        const details = element('div', '', 'run-step-detail')
        details.append(element('p', `${targetLabel(step.target)} · ${step.actor === 'human' ? '人工' : step.actor === 'program' ? '程序' : '模型'} · ${originLabels[step.origin] || step.origin || '计划'}`, 'meta run-step-status-detail'))
        if (step.error) { const error = element('div', '', 'run-step-error'); error.append(element('p', step.error), copyButton('复制', step.error)); details.append(error) }
        if (step.output?.passed !== undefined) {
          if (!step.output.passed) {
            const verdict = element('div', '', 'run-step-verdict')
            verdict.append(element('p', step.output.issues?.length ? JSON.stringify(step.output.issues, null, 2) : '审核未通过'), copyButton('复制', step.output.issues || '审核未通过'))
            details.append(verdict)
          }
        }
        const skill = skillsLine(step.skills); if (skill) details.append(skill)
        for (const attempt of step.attempts || []) details.append(element('p', `${attempt.label || '尝试'} · ${runStepStatusLabels[attempt.status] || attempt.status}${attempt.error ? ` · ${attempt.error}` : ''}`, 'meta'))
        if (promptActions.childElementCount) details.append(promptActions)

        item.append(details)
        stepList.append(item)
    }
    body.append(stepList)
  }

  const openRecordPage = async (step, kind) => {
    returnAction = draw; returnButton.textContent = '← 返回'
    title.textContent = `${stepLabel(step)} · ${kind === 'responses' ? 'HTTP 请求详情' : kind === 'artifacts' ? '生成快照详情' : '提示词详情'}`
    body.replaceChildren()
    const page = element('section', '', 'run-record-page')
    page.append(element('p', `${targetLabel(step.target)} · 步骤 ${stepLabel(step)}`, 'meta'))
    try {
      const result = await loadRecords(run, step, kind), entries = result?.[kind] || []
      if (!entries.length) {
        const emptyMessage = kind === 'responses' ? '此步骤没有保存 HTTP 请求。' : kind === 'artifacts' ? '此步骤没有保存生成快照。' : '此步骤没有保存提示词。'
        page.append(element('p', emptyMessage, 'meta')); body.append(page); return
      }
      if (kind === 'responses') {
        const tabs = element('div', '', 'tabs run-record-tabs'), panels = element('div', '', 'run-record-panels')
        const requestPanel = element('div', '', 'run-record-panel'), responsePanel = element('div', '', 'run-record-panel')
        for (const [key, label] of [['request', '请求'], ['response', '返回']]) {
          const tab = element('button', label); tab.setAttribute('aria-selected', String(key === 'request')); tab.onclick = () => {
            for (const node of tabs.querySelectorAll('button')) node.setAttribute('aria-selected', String(node === tab))
            requestPanel.hidden = key !== 'request'; responsePanel.hidden = key !== 'response'
          }; tabs.append(tab)
        }
        for (const [index, entry] of entries.entries()) {
          const request = entry.request || { method: entry.method, path: entry.path, headers: entry.headers }
          const response = { ok: entry.ok, status: entry.status, durationMs: entry.durationMs, body: entry.body, error: entry.error, bytes: entry.bytes }
          const requestCard = element('section', '', 'run-record-card'), responseCard = element('section', '', 'run-record-card')
          requestCard.append(element('h3', `请求 ${index + 1}`), element('pre', JSON.stringify(request, null, 2))); appendJsonCopy(requestCard, request)
          responseCard.append(element('h3', `返回 ${index + 1}`), element('pre', JSON.stringify(response, null, 2))); appendJsonCopy(responseCard, response)
          requestPanel.append(requestCard); responsePanel.append(responseCard)
        }
        responsePanel.hidden = true; panels.append(requestPanel, responsePanel); page.append(tabs, panels)
      } else if (kind === 'artifacts') {
        for (const [index, artifact] of entries.entries()) {
          const card = element('section', '', 'run-record-card')
          card.append(element('h3', `${index + 1}. ${targetLabel(artifact.target)} · ${artifact.published ? '已保存' : '草稿'}${artifact.version ? ` · V${artifact.version}` : ''}`))
          const value = artifact.content
          card.append(element('pre', artifact.target === 'outline' && value && typeof value === 'object' ? outlineText(value) : typeof value === 'string' ? value : JSON.stringify(value, null, 2)))
          appendJsonCopy(card, value); page.append(card)
        }
      } else {
        for (const [index, entry] of entries.entries()) {
          const card = element('section', '', 'run-record-card'); card.append(element('h3', `请求 ${index + 1}`))
          if (entry.messages) for (const message of entry.messages) card.append(element('h4', message.role), element('pre', typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)))
          else card.append(element('pre', typeof entry.prompt === 'string' ? entry.prompt : JSON.stringify(entry.prompt ?? entry, null, 2)))
          appendJsonCopy(card, entry.messages || entry.prompt || entry); page.append(card)
        }
      }
    } catch (error) { page.append(element('p', `加载失败：${error.message}`, 'error')) }
    body.append(page)
  }

  view.refresh = async () => { const id = ++requestId
    try { const result = await load(); if (id !== requestId) return; run = result.run; draw() }
    catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
  }
  returnButton.onclick = () => returnAction?.(); void view.refresh(); return view
}
