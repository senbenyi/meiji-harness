import { element, appendJsonCopy } from './panel-dom.js'
import { openStepPrompts } from './task-prompt.js'
import { targetLabel, stepKindLabels, skillsLine } from './run-labels.js'
import { runStatusLabels, runStepStatusLabels, runGoalLabel, runTargetMatches } from '../shared/run-view.js'
import { outlineText } from '../shared/story-outline.js'
import { goalForRunTarget } from '../shared/run-templates.js'
import { confirmRunPreview } from './run-preview.js'
const time = value => value ? new Date(value).toLocaleString() : '—'
const kindLabels = { ...stepKindLabels, manual_edit: '人工编辑', image: '生成图片', wait_confirm: '等待图片确认', wait_script_confirm: '等待剧本确认', storyboard: '文本分镜', video: '生成视频', tail: '提取尾帧', sync: '回写剧本', expand: '展开镜头' }
const originLabels = { plan: '计划', 'review-fail': '审核反馈', manual: '人工', 'user-feedback': '用户反馈' }
const eventLabels = { confirmed: '任务已确认', paused: '任务已暂停', resumed: '任务已继续', retry: '重试步骤', cancelled: '任务已取消', completed: '任务已完成', amended: '目标已并入', interrupted: '执行中断', deletions_confirmed: '删除范围已确认', override: '人工放行' }

export function renderRunDetail(project, { load, back, control, loadRecords, preview, edit, followup, target = '' }) {
  const view = element('section', '', 'task-history-page run-detail-page')
  const header = element('div', '', 'task-history-header'), returnButton = element('button', '← 返回任务列表'), refresh = element('button', '刷新')
  returnButton.onclick = back; header.append(returnButton, element('h2', '任务详情'), refresh)
  const message = element('p', '', 'error'), body = element('div')
  view.append(header, message, body)
  let run, requestId = 0, busy = false
  async function act(endpoint, fields = {}) {
    if (busy) return
    busy = true; message.textContent = ''
    for (const button of body.querySelectorAll('[data-run-control]')) button.disabled = true
    try { await control(run, endpoint, fields); await view.refresh() }
    catch (error) { message.textContent = error.message }
    finally { busy = false; for (const button of body.querySelectorAll('[data-run-control]')) button.disabled = false }
  }
  const actionButton = (text, endpoint, fields) => { const button = element('button', text); button.dataset.runControl = endpoint; button.disabled = busy; button.onclick = () => act(endpoint, fields); return button }
  const draw = () => {
    const expanded = new Set([...body.querySelectorAll('details[data-step-id][open]')].map(node => node.dataset.stepId))
    const drafts = new Map([...body.querySelectorAll('input.run-feedback')].map(node => [node.dataset.stepId, node.value]))
    body.replaceChildren()
    body.append(element('h3', runGoalLabel(run, project)), element('p', `${runStatusLabels[run.status]} · ${run.initiator === 'session' ? '会话发起' : '面板发起'} · 开始 ${time(run.startedAt || run.createdAt)} · 结束 ${time(run.endedAt)}`, 'meta'))
    const controls = element('div', '', 'run-controls')
    if (run.status === 'running') controls.append(actionButton('暂停', 'pause'))
    if (!['completed', 'cancelled'].includes(run.status)) controls.append(actionButton('取消任务', 'cancel'))
    body.append(controls)
    if (run.optionalGoals?.length) {
      const optional = element('section'); optional.append(element('h3', '可选后续'), element('p', '剧本已更新。这些剧集使用旧依据，可选择预览重新生成。', 'meta'))
      for (const choice of run.optionalGoals) {
        const index = [...project.episodes].reverse().findIndex(episode => episode.id === choice.episodeId), button = element('button', `预览重新生成第 ${index + 1} 集摘要`)
        button.onclick = async () => { button.disabled = true; try { await followup?.(choice) } catch (error) { message.textContent = error.message } finally { button.disabled = false } }; optional.append(button)
      }
      body.append(optional)
    }
    for (const reason of run.pause?.reasons || []) {
      const row = element('section', '', 'run-reason'); row.append(element('p', reason.message || reason.code))
      for (const action of reason.actions || []) {
        if (['retry', 'resume', 'review'].includes(action)) row.append(actionButton(action === 'retry' ? '重试此步骤' : action === 'review' ? '复审后继续' : '继续任务', 'resume', { action, stepId: reason.stepId }))
        else if (action === 'cancel-branch') row.append(actionButton('取消此分支', 'cancel', { stepId: reason.stepId }))
        else if (action === 'override') row.append(actionButton('忽略并通过', 'resume', { action, stepId: reason.stepId }))
        else if (action === 'edit' && edit) { const button = element('button', '编辑此对象'); button.onclick = () => edit(run, reason.target); row.append(button) }
        else if (action === 'authorize' && preview) {
          const button = element('button', '选择前置并继续')
          button.onclick = async () => {
            button.disabled = true
            try {
              const initial = await preview(run, {}), accepted = await confirmRunPreview(button, initial, { refresh: authorizePrereq => preview(run, { authorizePrereq }) })
              if (accepted?.authorizePrereq.length) await act('resume', { action, stepId: reason.stepId, ...accepted })
            } catch (error) { message.textContent = error.message } finally { button.disabled = false }
          }
          row.append(button)
        } else if ((action === 'feedback' || action === 'regenerate') && preview) {
          let input
          if (action === 'feedback') { input = element('input', '', 'run-feedback'); input.dataset.stepId = reason.stepId; input.value = drafts.get(reason.stepId) || ''; input.placeholder = '本次修改意见'; input.maxLength = 2000; row.append(input) }
          const button = element('button', action === 'feedback' ? '提交意见并继续' : '重新生成')
          button.onclick = async () => {
            const feedback = input?.value.trim()
            if (input && !feedback) { message.textContent = '请填写本次意见'; return }
            const goal = goalForRunTarget(reason.target, feedback ? { feedback } : { mode: 'regenerate' })
            button.disabled = true
            try {
              const initial = await preview(run, { goal }), accepted = await confirmRunPreview(button, { ...initial, amend: true }, { refresh: authorizePrereq => preview(run, { goal, authorizePrereq }) })
              if (accepted) await act('amend', { goal, ...accepted })
            } catch (error) { message.textContent = error.message } finally { button.disabled = false }
          }
          row.append(button)
        }
      }
      body.append(row)
    }
    const groups = new Map()
    for (const step of run.steps) { if (!groups.has(step.target)) groups.set(step.target, []); groups.get(step.target).push(step) }
    const shownEvents = new Set()
    for (const [key, steps] of groups) {
      const group = element('section', '', 'run-target-group'); group.dataset.target = key || ''
      if (target && runTargetMatches(key, target)) { group.classList.add('is-highlighted'); group.setAttribute('aria-label', '当前对象') }
      group.append(element('h3', targetLabel(key)))
      for (const step of [...steps].sort((a, b) => String(a.startedAt || a.createdAt || '\uffff').localeCompare(String(b.startedAt || b.createdAt || '\uffff')))) {
        const item = element('details', '', `run-step is-${step.status}`); item.dataset.stepId = step.id; item.open = expanded.has(step.id)
        item.append(element('summary', `${kindLabels[step.kind] || step.kind}${step.round ? ` · 第 ${step.round} 轮` : ''} · ${runStepStatusLabels[step.status]} · ${originLabels[step.origin] || step.origin || '计划'}`))
        item.append(element('p', `${step.actor === 'human' ? '人工' : step.actor === 'program' ? '程序' : '模型'} · 开始 ${time(step.startedAt)} · 结束 ${time(step.endedAt)}`, 'meta'))
        if (step.error) item.append(element('p', step.error, 'error'))
        if (step.output?.passed !== undefined) item.append(element('p', step.output.passed ? '审核通过' : '审核未通过', step.output.passed ? 'meta' : 'error'))
        if (step.output?.issues?.length) { const data = element('pre', JSON.stringify(step.output.issues, null, 2)); item.append(data) }
        const skill = skillsLine(step.skills); if (skill) item.append(skill)
        for (const attempt of step.attempts || []) item.append(element('p', `${attempt.label || '尝试'} · ${runStepStatusLabels[attempt.status] || attempt.status}${attempt.error ? ` · ${attempt.error}` : ''}`, 'meta'))
        for (const [kind, label] of [['prompts', '查看提示词'], ['responses', '查看原始返回']]) {
          if (!step[kind]?.length) continue
          const button = element('button', label, `task-step-${kind === 'prompts' ? 'prompt' : 'response'}`)
          button.onclick = () => openStepPrompts(button, { title: `${kindLabels[step.kind] || step.kind} · ${label}`, load: () => loadRecords(run, step, kind) }); item.append(button)
        }
        const snapshot = element('div', '', 'run-artifacts'); let loaded = false
        item.append(snapshot)
        item.ontoggle = async () => {
          if (!item.open || loaded || !step.artifacts?.length) return
          snapshot.textContent = '加载内容快照…'
          try {
            const { artifacts } = await loadRecords(run, step, 'artifacts'); snapshot.replaceChildren()
            for (const artifact of artifacts || []) {
              const card = element('section'); card.append(element('h4', `${targetLabel(artifact.target)} · ${artifact.published ? '已保存' : '草稿'}${artifact.version ? ` · V${artifact.version}` : ''}`))
              const value = artifact.content
              card.append(element('pre', artifact.target === 'outline' && value && typeof value === 'object' ? outlineText(value) : typeof value === 'string' ? value : JSON.stringify(value, null, 2)))
              appendJsonCopy(card, value); snapshot.append(card)
            }
            loaded = true
          } catch (error) { snapshot.textContent = `加载失败：${error.message}。收起后展开重试。` }
        }
        group.append(item)
        for (const [index, event] of (run.events || []).entries()) if (event.stepIds?.includes(step.id) && !shownEvents.has(index)) {
          group.append(element('p', `${time(event.at)} · ${eventLabels[event.type] || event.type}`, 'meta run-event')); shownEvents.add(index)
        }
      }
      body.append(group)
    }
    const events = element('details', '', 'run-events'); events.append(element('summary', '任务事件'))
    for (const event of run.events || []) events.append(element('p', `${time(event.at)} · ${eventLabels[event.type] || event.type}${event.actor ? ` · ${event.actor === 'user' || event.actor === 'human' ? '人工' : '系统'}` : ''}`, 'meta'))
    body.append(events)
  }
  view.refresh = async () => { const id = ++requestId; refresh.disabled = true
    try { const result = await load(); if (id !== requestId) return; run = result.run; draw() }
    catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
    finally { if (id === requestId) refresh.disabled = false }
  }
  refresh.onclick = view.refresh; void view.refresh(); return view
}
