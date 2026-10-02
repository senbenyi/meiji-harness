import { DomainValidationError } from './errors.js'

export function assertRightsGate(project, action = 'generate') {
  if (project.productionSpec?.contentRating !== 'adult') return
  const records = Object.values(project.rightsRecords || {})
  const active = records.filter((item) => !item.revokedAt)
  const adultConfirmed = active.some((item) => item.kind === 'age_confirmation' && item.subjectAdult === true)
  const licensed = active.some((item) => item.kind === 'license' || item.kind === 'consent')
  if (!adultConfirmed || !licensed) {
    const missing = []
    if (!adultConfirmed) missing.push('age_confirmation (studio_rights_record with kind:"age_confirmation", subjectAdult:true)')
    if (!licensed) missing.push('consent/license (studio_rights_record with kind:"consent" or "license")')
    throw new DomainValidationError(`rights gate blocked ${action}: missing ${missing.join(' + ')}`, { adultConfirmed, licensed })
  }
}

export function assertRuntimeVerified(project, capability) {
  const health = project.runtimeHealth?.[capability]
  if (!health || health.status !== 'runtime_verified' || !health.verifiedAt || !health.hash) {
    throw new DomainValidationError(`capability is not runtime verified: ${capability}`)
  }
}

export function assertTimelineAssets(project, assetIds) {
  const issues = []
  for (const assetId of assetIds) {
    const asset = project.assets[assetId]
    if (!asset || asset.status !== 'approved') {
      const shot = Object.values(project.shots).find((s) => s.assetIds?.includes(assetId))
      const reviewTask = Object.values(project.reviewTasks).find((t) => t.targetId === assetId)
      issues.push({
        assetId,
        currentStatus: asset?.status || 'missing',
        shotId: shot?.id || null,
        shotTitle: shot?.title || null,
        reviewTaskId: reviewTask?.id || null,
        reviewStatus: reviewTask?.status || null,
      })
    }
  }
  if (issues.length) {
    throw new DomainValidationError(
      `timeline assets must be approved: ${issues.map((i) => `${i.assetId}(${i.currentStatus}, shot:${i.shotTitle || i.shotId || '?'})`).join(', ')}`,
      { issues },
    )
  }
}

export function assertDeliverableReady(project, timelineId) {
  const timeline = project.timelines[timelineId]
  if (!timeline || !['ready', 'exported'].includes(timeline.status)) {
    throw new DomainValidationError(`timeline is not ready: ${timelineId}`)
  }
  assertRightsGate(project, 'deliver')
}
