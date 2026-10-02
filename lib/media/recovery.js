import { classifyGenerationFailure } from './failures.js'

export function attemptDiagnostics(attempt) {
  const failure = attempt.failureClass
    ? { failureClass: attempt.failureClass, retryable: attempt.retryable === true }
    : attempt.error ? classifyGenerationFailure(attempt.error, { stage: attempt.failureStage }) : { failureClass: 'none', retryable: false }
  if (attempt.status === 'completed' || attempt.status === 'cancelled') {
    return { recoveryState: 'terminal', failureClass: failure.failureClass, recommendedAction: 'none', duplicateChargeRisk: 'none', automatic: false }
  }
  if (attempt.status === 'submission_unknown') {
    return { recoveryState: 'manual_confirmation', failureClass: 'uncertain_submission', recommendedAction: 'confirm_external', duplicateChargeRisk: 'high', automatic: false }
  }
  if (attempt.status === 'failed') {
    if (failure.failureClass === 'download_failure' && attempt.promptId) {
      return { recoveryState: 'retry_download', failureClass: failure.failureClass, recommendedAction: 'retry_download', duplicateChargeRisk: 'none', automatic: false }
    }
    return { recoveryState: 'terminal', failureClass: failure.failureClass, recommendedAction: failure.retryable ? 'create_new_attempt' : 'fix_configuration', duplicateChargeRisk: 'possible', automatic: false }
  }
  if (attempt.status === 'created') {
    return { recoveryState: 'none', failureClass: 'none', recommendedAction: 'submit', duplicateChargeRisk: 'none', automatic: true }
  }
  if (['queued', 'running', 'downloading'].includes(attempt.status) && attempt.promptId) {
    return { recoveryState: 'auto_resume', failureClass: failure.failureClass, recommendedAction: 'resume', duplicateChargeRisk: 'none', automatic: true }
  }
  return { recoveryState: 'manual_confirmation', failureClass: failure.failureClass, recommendedAction: 'inspect', duplicateChargeRisk: 'possible', automatic: false }
}

export function recoveryPlan(project) {
  return Object.values(project.attempts || {}).map((attempt) => {
    const diagnostics = attemptDiagnostics(attempt)
    if (diagnostics.recoveryState === 'terminal') return null
    const actions = { submit: 'submit', confirm_external: 'confirm-external', resume: 'resume-history', retry_download: 'retry-download', inspect: 'inspect' }
    return { attemptId: attempt.id, action: actions[diagnostics.recommendedAction] || diagnostics.recommendedAction, promptId: attempt.promptId || undefined, automatic: diagnostics.automatic, ...diagnostics }
  }).filter(Boolean)
}

export async function scanRecoverable(projectService) {
  const projects = await projectService.listProjects()
  return projects.flatMap((project) => recoveryPlan(project).map((item) => ({ projectId: project.id, ...item })))
}
