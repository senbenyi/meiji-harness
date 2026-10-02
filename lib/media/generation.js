import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assetLogicalKey } from '../storage/layout.js'
import { classifyGenerationFailure } from './failures.js'
import { attemptDiagnostics } from './recovery.js'

async function execute(service, projectId, type, payload, actor = 'attempt-runner') {
  const project = await service.getProject(projectId)
  return service.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type, payload, actor })
}

export class GenerationRunner {
  constructor({ projectService, comfyClient, fileService }) {
    this.projects = projectService
    this.comfy = comfyClient
    this.files = fileService
  }

  async submit({ projectId, attemptId, graph, signal }) {
    const project = await this.projects.getProject(projectId)
    const attempt = project.attempts[attemptId]
    if (!attempt || attempt.status !== 'created') throw new Error(`attempt must exist in created state before submit: ${attemptId}`)
    try {
      const submitted = await this.comfy.submit(graph, { signal, clientId: attempt.idempotencyKey })
      await execute(this.projects, projectId, 'markAttemptSubmitted', { attemptId, promptId: submitted.promptId })
      return submitted
    } catch (error) {
      const failure = classifyGenerationFailure(error, { stage: 'submit' })
      if (failure.submissionUncertain) await execute(this.projects, projectId, 'markAttemptSubmitted', { attemptId, submissionUnknown: true })
      else await execute(this.projects, projectId, 'failGenerationAttempt', { attemptId, error: failure.message, failureClass: failure.failureClass, retryable: failure.retryable, failureStage: 'submit' })
      throw error
    }
  }

  async complete({ projectId, attemptId, promptId, signal }) {
    let project = await this.projects.getProject(projectId)
    let attempt = project.attempts[attemptId]
    if (!attempt) throw new Error(`attempt not found: ${attemptId}`)
    if (attempt.status === 'queued') {
      await execute(this.projects, projectId, 'advanceGenerationAttempt', { attemptId, status: 'running' })
    } else if (!['running', 'downloading'].includes(attempt.status)) {
      throw new Error(`attempt cannot resume completion from ${attempt.status}`)
    }
    const history = await this.comfy.wait(promptId, { signal })
    const outputs = this.comfy.outputs(history)
    if (!outputs.length) throw new Error(`ComfyUI returned no media output: ${promptId}`)
    project = await this.projects.getProject(projectId)
    attempt = project.attempts[attemptId]
    if (attempt.status !== 'downloading') await execute(this.projects, projectId, 'advanceGenerationAttempt', { attemptId, status: 'downloading' })
    const file = outputs[0]
    const buffer = await this.comfy.download(file, signal)
    const extension = extname(file.filename).slice(1) || 'bin'
    const assetId = `${attemptId}-output-0`
    const logicalKey = assetLogicalKey(projectId, assetId, extension)
    const descriptor = await this.files.atomicWrite(logicalKey, buffer)
    return execute(this.projects, projectId, 'completeGenerationAttempt', {
      attemptId, assetId, kind: file.kind === 'images' ? 'image' : file.kind === 'audio' ? 'audio' : 'video',
      ...descriptor, media: { filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' },
      provenance: { provider: 'comfyui', promptId, nodeId: file.nodeId },
    })
  }

  async run(input) {
    const submitted = await this.submit(input)
    try {
      return await this.complete({ ...input, promptId: submitted.promptId })
    } catch (error) {
      const project = await this.projects.getProject(input.projectId)
      const attempt = project.attempts[input.attemptId]
      if (attempt && !['completed', 'failed', 'cancelled'].includes(attempt.status)) {
        const failureStage = attempt.status === 'downloading' ? 'download' : 'run'
        const failure = classifyGenerationFailure(error, { stage: failureStage })
        await execute(this.projects, input.projectId, 'failGenerationAttempt', {
          attemptId: input.attemptId, error: failure.message, failureClass: failure.failureClass,
          retryable: failure.retryable, failureStage,
        })
      }
      throw error
    }
  }

  async recover({ projectId, attemptId, signal }) {
    let project = await this.projects.getProject(projectId)
    let attempt = project.attempts[attemptId]
    if (!attempt) throw new Error(`attempt not found: ${attemptId}`)
    const diagnostics = attemptDiagnostics(attempt)
    if (diagnostics.recoveryState === 'retry_download') {
      await execute(this.projects, projectId, 'recoverGenerationAttempt', { attemptId, decision: 'resume' })
      project = await this.projects.getProject(projectId)
      attempt = project.attempts[attemptId]
    }
    if (diagnostics.recoveryState !== 'auto_resume' && diagnostics.recoveryState !== 'retry_download') {
      throw new Error(`attempt requires ${diagnostics.recommendedAction}: ${attemptId}`)
    }
    return this.complete({ projectId, attemptId, promptId: attempt.promptId, signal })
  }
}
