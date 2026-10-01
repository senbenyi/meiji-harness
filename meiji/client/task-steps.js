// 步骤清单组件：「当前任务」与「任务历史」两个页面共用。
// 按目标（摘要、各镜头的文本提示词与成片……）分组，显示每个步骤的类型、状态、审核结论与理由、错误、执行者、起止时间；
// live 时高亮当前步骤，并显示已用时间、同一步骤内的尝试（如续传 2/3）与视频的远端任务编号。
import { currentStep, groupByTarget } from '../shared/steps.js'
import { element } from './dom.js'
import { openStepPrompts } from './task-prompt.js'

export const taskStatusLabels = { queued: '排队中', running: '执行中', waiting: '等待人工', completed: '完成', review_failed: '审核未通过', failed: '失败', cancelled: '已取消' }
export const stepStatusLabels = { pending: '未执行', running: '执行中', waiting: '等待人工', completed: '完成', failed: '失败', cancelled: '已取消', skipped: '已跳过' }
export const stepKindLabels = { execute: '执行', save: '保存', generate: '生成', review: '自审', revise: '修订', re_review: '复审', check: '内容校验', override: '人工放行',
  video_submit: '提交视频', video_generate: '生成视频', image_generate: '调用图片 API', image_download: '下载图片并转 Base64', image_base64: '转 Base64', image_save: '保存候选图片', tail_frame: '提取尾帧', assemble: '全片拼接', confirm: '处理候选图片', checkpoint: '人工关卡' }
const targetLabels = { summary: '摘要', story: '剧情', outline: '剧情', characters: '角色', scenes: '场景', shots: '镜头表', seconds: '每秒指令', storyboard: '文本提示词', film: '成片', assembly: '合成视频', image: '图片', pencil: '铅笔分镜' }

export function targetLabel(target) {
  if (!target) return '本任务'
  const [kind, id, slot] = target.split(':')
  return [targetLabels[kind] || kind, id, slot].filter(Boolean).join(' · ')
}

const clock = value => value ? new Date(value).toLocaleTimeString() : '—'
export function elapsedText(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒` : `${seconds}秒`
}

function renderStep(step, current, now, loadPrompts) {
  const item = element('li', '', `task-step is-${step.status}${current ? ' is-current' : ''}`)
  if (current) item.setAttribute('aria-current', 'step')
  const head = element('div', '', 'task-step-head')
  head.append(element('strong', stepKindLabels[step.kind] || step.label || step.kind), element('span', stepStatusLabels[step.status] || step.status, `task-step-status is-${step.status}`))
  if (['generate', 'review', 'revise', 're_review', 'image_generate', 'video_submit'].includes(step.kind) || step.prompts?.length) {
    const button = element('button', '查看提示词', 'task-step-prompt')
    button.type = 'button'
    button.disabled = !loadPrompts || (!step.prompts?.length && ['pending', 'skipped'].includes(step.status))
    button.title = step.prompts?.length ? '查看该步骤实际提交的完整提示词' : step.status === 'skipped' ? '该步骤已跳过，没有生成提示词' : step.status === 'pending' ? '提示词尚未生成' : '查看该步骤的请求日志；没有记录时显示原因'
    button.onclick = () => openStepPrompts(button, { title: `${stepKindLabels[step.kind] || step.kind} · 完整提示词`, load: () => loadPrompts(step) })
    head.append(button)
  }
  if (step.actor === 'human') head.append(element('span', '人工', 'task-step-actor'))
  item.append(head)
  if (step.label && stepKindLabels[step.kind]) item.append(element('p', step.label, 'meta'))
  if (step.verdict) item.append(element('p', step.verdict === 'pass' ? (step.kind === 'override' ? '人工放行，视为通过' : '审核通过') : `审核未通过：${(step.reasons || []).join('；') || '未给出原因'}`, `task-step-verdict is-${step.verdict}`))
  if (step.error) item.append(element('p', step.error, 'error'))
  const attempts = step.attempts || []
  if (attempts.length) {
    item.append(element('p', `尝试 ${attempts.length} 次`, 'meta'))
    for (const attempt of attempts) item.append(element('p', `${attempt.label}：${stepStatusLabels[attempt.status] || attempt.status}${attempt.error ? `（${attempt.error}）` : ''}`, 'meta task-step-attempts'))
  }
  if (step.remoteId) item.append(element('p', `远端任务：${step.remoteId}`, 'meta task-step-remote'))
  if (current && step.startedAt) {
    const elapsed = element('p', `已用 ${elapsedText(step.startedAt, now)}`, 'meta task-step-elapsed')
    elapsed.dataset.startedAt = step.startedAt
    item.append(elapsed)
  } else if (step.startedAt) item.append(element('p', `开始 ${clock(step.startedAt)}　结束 ${clock(step.endedAt)}`, 'meta'))
  return item
}

export function renderSteps(steps = [], { live = false, now = Date.now(), loadPrompts } = {}) {
  const view = element('div', '', 'task-steps')
  const current = live ? currentStep(steps) : null
  for (const group of groupByTarget(steps)) {
    const section = element('section', '', `task-steps-group is-${group.status}`)
    const head = element('h4', '', 'task-steps-target')
    head.append(element('span', targetLabel(group.target)), element('span', taskStatusLabels[group.status] || group.status, `task-history-status is-${group.status}`))
    const list = element('ol', '', 'task-steps-list')
    for (const step of group.steps) list.append(renderStep(step, step === current, now, loadPrompts))
    section.append(head, list)
    view.append(section)
  }
  return view
}

// 本地时钟更新已用时间（不向服务端请求）。
export function tickElapsed(root, now = Date.now()) {
  for (const node of root.querySelectorAll('.task-step-elapsed[data-started-at]')) node.textContent = `已用 ${elapsedText(node.dataset.startedAt, now)}`
}
