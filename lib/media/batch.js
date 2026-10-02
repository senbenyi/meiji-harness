/**
 * BatchRunner — 多镜头批量生成编排器。
 *
 * 职责：按集（episodeId）或显式 shotIds 收集待生成镜头，逐镜头调用 generateFn，
 * 单镜头失败不阻断其余镜头，返回聚合结果。
 */
export class BatchRunner {
  /**
   * @param {object} deps
   * @param {(projectId: string) => Promise<object>} deps.getProject
   */
  constructor({ getProject }) {
    this.getProject = getProject
  }

  /**
   * @param {object} options
   * @param {string} options.projectId
   * @param {string} [options.episodeId]
   * @param {string[]} [options.shotIds]
   * @param {(shot: object) => Promise<object>} options.generateFn - per-shot generation callback
   * @returns {Promise<{ total: number, completed: number, failed: number, skipped: number, results: object[] }>}
   */
  async run({ projectId, episodeId, shotIds, generateFn }) {
    if (!generateFn) throw new Error('batch requires generateFn')
    const project = await this.getProject(projectId)

    let targetIds
    if (shotIds?.length) {
      for (const id of shotIds) {
        if (!project.shots[id]) throw new Error(`shot not found: ${id}`)
      }
      targetIds = shotIds
    } else if (episodeId) {
      const episode = project.episodes[episodeId]
      if (!episode) throw new Error(`episode not found: ${episodeId}`)
      targetIds = (episode.shotIds || []).filter((id) => project.shots[id])
    } else {
      throw new Error('batch requires episodeId or shotIds')
    }

    const GENERATABLE = ['ready', 'rejected', 'invalidated']
    const results = []
    for (const shotId of targetIds) {
      // Re-read project before each shot to avoid stale snapshot
      const fresh = await this.getProject(projectId)
      const shot = fresh.shots[shotId]
      if (!shot || !GENERATABLE.includes(shot.status)) {
        results.push({ shotId, status: 'skipped', reason: `status:${shot?.status || 'missing'}` })
        continue
      }
      try {
        const output = await generateFn(shot)
        results.push({ shotId, status: 'completed', output })
      } catch (error) {
        const isConflict = error.code === 'conflict'
        results.push({ shotId, status: isConflict ? 'conflict' : 'failed', error: error.message, retryable: isConflict })
      }
    }

    return {
      total: targetIds.length,
      completed: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed' || r.status === 'conflict').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    }
  }
}
