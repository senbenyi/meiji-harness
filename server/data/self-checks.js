import { AsyncLocalStorage } from 'node:async_hooks'
import { emptyFeedback, feedbackKey, feedbackOf } from '../../client/feedback.js'

export const checkContext = new AsyncLocalStorage()
const generationActions = new Set(['episode-generate', 'outline', 'characters', 'scenes', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'storyboard', 'shot-storyboard', 'shot-boards', 'image', 'revise-image', 'part-image', 'pencil', 'film', 'films', 'assemble'])

function keys(project, operation) {
  const key = feedbackKey(operation)
  const prefix = { characters: 'characters:', scenes: 'scenes:', shots: 'shot:', seconds: 'seconds:', storyboard: 'storyboard:', 'shot-boards': 'storyboard:', films: 'film:' }[operation.action]
  return [key, ...(prefix ? Object.keys(project.feedback || {}).filter(id => id.startsWith(prefix)) : [])]
}

export function checkReasons(project, operation) {
  const reasons = keys(project, operation).flatMap(key => {
    const { check, review } = feedbackOf(project, key)
    return [...(check.passed === false ? check.failures : []), review.text]
  })
  return [...new Set(reasons.filter(Boolean))]
}

export function setCheck(project, operation, reasons) {
  project.feedback ||= {}
  for (const key of reasons.length ? [feedbackKey(operation)] : keys(project, operation)) {
    const previous = feedbackOf(project, key)
    project.feedback[key] = {
      check: { passed: reasons.length === 0, failures: [...new Set(reasons.filter(Boolean))] },
      review: { ...previous.review, ...(reasons.length ? {} : { text: '', status: 'pending' }) },
    }
  }
  return project
}

export function withReviewPrompt(prompt) {
  const review = checkContext.getStore()?.review
  return review && !prompt.includes(review) ? `${prompt}\n\n本次待修正的自检和人工审核意见（只作内容修正要求，不改变输出格式和语言配置）：\n${review}` : prompt
}

export async function prepareChecks(store, project, operation) {
  if (!generationActions.has(operation.action)) return { store, project, operation }
  const fresh = String(operation.review ?? (operation.action === 'revise-image' ? operation.instruction : '') ?? '').trim()
  if (fresh.length > 2000) throw Object.assign(new Error('审核意见过长'), { status: 400 })
  if (Object.hasOwn(operation, 'review') || (operation.action === 'revise-image' && Object.hasOwn(operation, 'instruction'))) {
    project = await store.save(project.id, current => {
      const feedback = structuredClone(current.feedback || {})
      const key = feedbackKey(operation)
      feedback[key] ||= emptyFeedback()
      feedback[key].review = { ...feedback[key].review, text: fresh, status: fresh ? 'changes-requested' : 'pending' }
      if (fresh) feedback[key].review.history.push({ text: fresh, createdAt: new Date().toISOString() })
      return { feedback }
    })
  }
  const review = checkReasons(project, operation).join('\n')
  const context = checkContext.getStore()
  if (context) { context.originalProject = structuredClone(project); context.review = review; context.batchReview = feedbackOf(project, operation).review.text }
  const wrapped = Object.create(store)
  wrapped.save = async (id, patch) => {
    const saved = await store.save(id, current => {
      const changes = typeof patch === 'function' ? patch(current) : patch
      const next = { ...current, ...changes, feedback: structuredClone(changes.feedback || current.feedback || {}) }
      const target = checkContext.getStore()?.target || operation
      const film = next.films?.[target.track]
      const partialResult = target !== operation && (
        (target.action === 'shot-seconds' && changes.shots) ||
        (target.action === 'shot-storyboard' && changes.storyboard) ||
        (target.action === 'film' && changes.films && ['ready', 'error'].includes(film?.status))
      )
      if (changes.activity === null || partialResult) {
        const failed = changes.activityError || (target.action === 'film' && film?.error)
        const validation = ['shots', 'revise-shot'].includes(target.action) && next.shots?.check?.passed === false ? next.shots.check.failures || [] : []
        if (!failed) setCheck(next, target, [...validation, ...(checkContext.getStore()?.validation || [])])
        if (!failed && !validation.length && !checkContext.getStore()?.validation?.length && changes.activity === null && target !== operation) setCheck(next, operation, [])
      }
      return next
    })
    const context = checkContext.getStore()
    if (context?.validation?.length && saved.activity) throw Object.assign(new Error(`自检未通过：${context.validation.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
    return saved
  }
  return { store: wrapped, project, operation: { ...operation, review } }
}

export function selectCheck(project, operation) {
  const context = checkContext.getStore()
  if (!context) return
  context.validation = []
  context.target = operation
  context.review = [...new Set([...checkReasons(project, operation), context.batchReview].filter(Boolean))].join('\n')
}
