import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path'
import { ffmpegConcat } from '../concat.js'
import { deliverableLogicalKey } from '../storage/layout.js'

function assertSafePath(absPath, root) {
  const rel = relative(root, normalize(absPath))
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`export-path-traversal: path escapes workspace root: ${absPath}`)
  }
}

export class DeliveryService {
  constructor(projectService) { this.projects = projectService }

  async plan(projectId, timelineId, preset) {
    const project = await this.projects.getProject(projectId)
    return this.projects.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type: 'planDeliverable', payload: { timelineId, preset }, actor: 'delivery' })
  }

  async complete(projectId, payload) {
    const project = await this.projects.getProject(projectId)
    return this.projects.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type: 'recordDeliverable', payload, actor: 'delivery' })
  }

  /**
   * Execute a planned deliverable: transition to exporting, concat assets via ffmpeg, record result.
   * @param {string} projectId
   * @param {string} deliverableId
   * @param {string} root - workspace root for resolving asset logicalKeys
   */
  async execute(projectId, deliverableId, root) {
    if (!root || !isAbsolute(root)) throw new Error('export requires an absolute workspace root')

    // 1. transition planned → exporting
    let project = await this.projects.getProject(projectId)
    await this.projects.execute({
      projectId, commandId: randomUUID(), expectedRevision: project.revision,
      type: 'startDeliverableExport', payload: { deliverableId }, actor: 'delivery',
    })

    try {
      // 2. resolve timeline asset paths
      project = await this.projects.getProject(projectId)
      const deliverable = project.deliverables[deliverableId]
      const timeline = project.timelines[deliverable.timelineId]
      if (!timeline || !timeline.assetIds?.length) {
        throw new Error('export-empty-timeline: timeline has no assets')
      }

      // Validate asset statuses haven't changed since plan
      for (const assetId of timeline.assetIds) {
        const asset = project.assets[assetId]
        if (!asset || asset.status === 'invalidated') throw new Error(`export-asset-invalidated: asset ${assetId} is ${asset?.status || 'missing'}`)
      }

      const absPaths = await Promise.all(timeline.assetIds.map(async (assetId) => {
        const asset = project.assets[assetId]
        if (!asset?.logicalKey) throw new Error(`export-missing-asset: asset ${assetId} has no logicalKey`)
        const absPath = isAbsolute(asset.logicalKey) ? asset.logicalKey : resolve(root, asset.logicalKey)
        assertSafePath(absPath, root)
        await access(absPath).catch(() => { throw new Error(`export-file-missing: ${absPath} not accessible`) })
        return absPath
      }))

      // 3. concat via ffmpeg
      const logicalKey = deliverableLogicalKey(projectId, deliverableId, 'mp4')
      const outAbsPath = resolve(root, logicalKey)
      await mkdir(dirname(outAbsPath), { recursive: true })

      await ffmpegConcat(absPaths, outAbsPath)

      // 4. compute hash and record completion
      const buffer = await readFile(outAbsPath)
      const contentHash = createHash('sha256').update(buffer).digest('hex')
      const bytes = (await stat(outAbsPath)).size

      project = await this.projects.getProject(projectId)
      return await this.projects.execute({
        projectId, commandId: randomUUID(), expectedRevision: project.revision,
        type: 'completeDeliverableExport',
        payload: { deliverableId, contentHash, logicalKey, qualityReport: { bytes } },
        actor: 'delivery',
      })
    } catch (error) {
      // 5. on failure, mark as failed
      project = await this.projects.getProject(projectId)
      await this.projects.execute({
        projectId, commandId: randomUUID(), expectedRevision: project.revision,
        type: 'failDeliverableExport', payload: { deliverableId, error: error.message }, actor: 'delivery',
      }).catch(() => {})
      throw error
    }
  }
}
