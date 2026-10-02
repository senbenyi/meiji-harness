export function recoveryPlan(project) {
  return Object.values(project.attempts || {}).filter((attempt) => !['completed', 'failed', 'cancelled'].includes(attempt.status)).map((attempt) => {
    if (attempt.status === 'created') return { attemptId: attempt.id, action: 'submit', automatic: true }
    if (attempt.status === 'submission_unknown') return { attemptId: attempt.id, action: 'confirm-external', automatic: false }
    if (['queued', 'running', 'downloading'].includes(attempt.status) && attempt.promptId) return { attemptId: attempt.id, action: 'resume-history', promptId: attempt.promptId, automatic: true }
    return { attemptId: attempt.id, action: 'inspect', automatic: false }
  })
}

export async function scanRecoverable(projectService) {
  const projects = await projectService.listProjects()
  return projects.flatMap((project) => recoveryPlan(project).map((item) => ({ projectId: project.id, ...item })))
}
