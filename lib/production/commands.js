import { DomainConflictError } from '../domain/errors.js'

export function isRevisionConflict(error) {
  return error instanceof DomainConflictError
    && Number.isInteger(error.detail?.expectedRevision)
    && Number.isInteger(error.detail?.actualRevision)
}

/** Replays one idempotent command against the latest Project revision. */
export async function executeLatestProjectCommand(projects, command, maxAttempts = 4) {
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const project = await projects.getProject(command.projectId)
    try {
      return await projects.execute({ ...command, expectedRevision: project.revision })
    } catch (error) {
      lastError = error
      if (!isRevisionConflict(error)) throw error
    }
  }
  throw lastError
}
