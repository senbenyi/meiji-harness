import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assetLogicalKey } from '../storage/layout.js'

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
      await execute(this.projects, projectId, 'markAttemptSubmitted', { attemptId, submissionUnknown: true })
      throw error
    }
  }

  async complete({ projectId, attemptId, promptId, signal }) {
    await execute(this.projects, projectId, 'advanceGenerationAttempt', { attemptId, status: 'running' })
    const history = await this.comfy.wait(promptId, { signal })
    const outputs = this.comfy.outputs(history)
    if (!outputs.length) throw new Error(`ComfyUI returned no media output: ${promptId}`)
    await execute(this.projects, projectId, 'advanceGenerationAttempt', { attemptId, status: 'downloading' })
    const file = outputs[0]
    const buffer = await this.comfy.download(file, signal)
    const extension = extname(file.filename).slice(1) || 'bin'
    const assetId = randomUUID()
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
    return this.complete({ ...input, promptId: submitted.promptId })
  }
}
