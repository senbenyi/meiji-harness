import { DomainValidationError } from './errors.js'

export function assertRightsGate(project, action = 'generate') {
  if (project.productionSpec?.contentRating !== 'adult') return
  const records = Object.values(project.rightsRecords || {})
  const active = records.filter((item) => !item.revokedAt)
  const adultConfirmed = active.some((item) => item.kind === 'age_confirmation' && item.subjectAdult === true)
  const licensed = active.some((item) => item.kind === 'license' || item.kind === 'consent')
  if (!adultConfirmed || !licensed) {
    throw new DomainValidationError(`rights gate blocked ${action}`, { adultConfirmed, licensed })
  }
}

export function assertRuntimeVerified(project, capability) {
  const health = project.runtimeHealth?.[capability]
  if (!health || health.status !== 'runtime_verified' || !health.verifiedAt || !health.hash) {
    throw new DomainValidationError(`capability is not runtime verified: ${capability}`)
  }
}

export function assertTimelineAssets(project, assetIds) {
  for (const assetId of assetIds) {
    const asset = project.assets[assetId]
    if (!asset || asset.status !== 'approved') {
      throw new DomainValidationError(`timeline asset must be approved: ${assetId}`)
    }
  }
}

export function assertDeliverableReady(project, timelineId) {
  const timeline = project.timelines[timelineId]
  if (!timeline || !['ready', 'exported'].includes(timeline.status)) {
    throw new DomainValidationError(`timeline is not ready: ${timelineId}`)
  }
  assertRightsGate(project, 'deliver')
}
