import { DomainValidationError } from './errors.js'

export const STATE_TRANSITIONS = {
  project: {
    draft: ['active', 'cancelled'], active: ['blocked', 'completed', 'cancelled'], blocked: ['active', 'cancelled'],
    completed: ['archived'], archived: [], cancelled: [],
  },
  episode: {
    draft: ['planning', 'blocked', 'cancelled'], planning: ['assets', 'blocked', 'cancelled'], assets: ['shotlist', 'blocked', 'cancelled'],
    shotlist: ['storyboard', 'blocked', 'cancelled'], storyboard: ['rendering', 'blocked', 'cancelled'], rendering: ['assembly', 'blocked', 'cancelled'],
    assembly: ['review', 'blocked', 'cancelled'], review: ['delivered', 'rendering', 'blocked', 'cancelled'], delivered: [], blocked: ['draft', 'planning', 'assets', 'shotlist', 'storyboard', 'rendering', 'assembly', 'review'], cancelled: [],
  },
  shot: {
    planned: ['ready', 'invalidated', 'blocked'], ready: ['generating', 'invalidated', 'blocked'], generating: ['review', 'ready', 'invalidated', 'blocked'],
    review: ['generating', 'approved', 'rejected', 'ready', 'invalidated', 'blocked'], rejected: ['generating', 'ready', 'invalidated', 'blocked'],
    approved: ['assembled', 'invalidated', 'blocked'], invalidated: ['generating', 'ready', 'blocked'], assembled: ['invalidated'], blocked: ['ready', 'invalidated'],
  },
  attempt: {
    created: ['submitting', 'cancelled', 'failed'], submitting: ['queued', 'submission_unknown', 'failed'], submission_unknown: ['queued', 'failed', 'cancelled'],
    queued: ['running', 'failed', 'cancelled'], running: ['downloading', 'completed', 'failed', 'cancelled'], downloading: ['completed', 'failed', 'cancelled'],
    completed: [], failed: ['downloading'], cancelled: [],
  },
  asset: { candidate: ['approved', 'rejected', 'invalidated'], approved: ['invalidated', 'archived'], rejected: ['invalidated', 'archived'], invalidated: ['archived'], archived: [] },
  review: {
    pending: ['automated_check', 'awaiting_human', 'cancelled'], automated_check: ['awaiting_human', 'rejected'],
    awaiting_human: ['automated_check', 'approved', 'rejected', 'cancelled'], approved: [], rejected: [], cancelled: [],
  },
  timeline: { draft: ['ready', 'invalidated'], ready: ['ready', 'exported', 'invalidated'], invalidated: ['draft'], exported: ['ready', 'invalidated'] },
  deliverable: { planned: ['exporting', 'invalidated'], exporting: ['ready', 'failed', 'invalidated'], ready: ['delivered', 'invalidated'], delivered: ['invalidated'], failed: ['exporting', 'invalidated'], invalidated: ['planned'] },
  outbox: { pending: ['processing', 'dead'], processing: ['delivered', 'retry_wait', 'dead'], retry_wait: ['processing', 'dead'], delivered: [], dead: ['pending'] },
}

export function assertTransition(machine, from, to) {
  const allowed = STATE_TRANSITIONS[machine]?.[from]
  if (!allowed || !allowed.includes(to)) {
    throw new DomainValidationError(`illegal ${machine} transition: ${from} -> ${to}`, { machine, from, to })
  }
  return to
}

export function transition(entity, machine, to, extra = {}) {
  assertTransition(machine, entity.status, to)
  return { ...entity, ...extra, status: to, updatedAt: new Date().toISOString() }
}
