import { DomainValidationError } from './errors.js'
import { createHash } from 'node:crypto'

// Signatures bind visual preparation to the current entity or shot, not a canvas title.
export function preparationSignature(value) {
  return createHash('sha256').update(JSON.stringify({
    prompt: value.prompt, description: value.description, appearance: value.appearance,
    name: value.name, shotDescription: value.shotDescription, sourceRefs: value.sourceRefs,
    referenceBindings: value.referenceBindings, characterIds: value.characterIds, scriptVersion: value.scriptVersion,
  })).digest('hex')
}

export function isStandaloneShot(project, shot) {
  return shot?.episodeId === 'legacy-main' && !Object.keys(project.sourceDocuments || {}).length
}

function currentProposal(project, id, kind) {
  const proposal = project.developmentProposals?.[id]
  return proposal?.kind === kind && proposal.status === 'approved'
    && proposal.sourceRefs?.length > 0
    && proposal.sourceRefs?.every((ref) => project.sourceDocuments[ref.sourceId]?.contentHash === ref.contentHash)
}

export function isPreparedImage(project, assetId, signature) {
  const asset = project.assets?.[assetId]
  return Boolean(asset?.kind === 'image' && asset.status === 'approved' && asset.logicalKey
    && asset.contentHash && asset.bytes > 0 && (!signature || asset.provenance?.preparationSignature === signature))
}

export function productionStageIssues(project, shotId, { storyboard = true, images = true } = {}) {
  const shot = project.shots?.[shotId]
  if (isStandaloneShot(project, shot)) return []
  const issues = []
  const bible = project.storyBible
  if (!bible?.summary || !currentProposal(project, bible.proposalId, 'content_analysis')) issues.push({ stage: 'analysis', id: project.id, reason: '缺少当前源文的已批准内容分析' })
  const episode = project.episodes?.[shot?.episodeId]
  if (!episode?.script || episode.script === episode.outline || !currentProposal(project, episode.proposalId, 'episode_script')
    || episode.analysisProposalId !== bible?.proposalId || shot?.analysisProposalId !== bible?.proposalId
    || shot?.proposalId !== episode?.proposalId || !episode.shotIds?.includes(shotId) || !shot?.shotDescription || !shot.prompt || !(shot.duration > 0)) {
    issues.push({ stage: 'scripts', id: episode?.id || shotId, reason: '缺少有效正式剧本与对应分镜，不能用大纲或模板替代' })
  }
  const bindings = (shot?.referenceBindings || []).filter((binding) => ['character', 'location'].includes(binding.kind))
  const charactersMissing = Array.isArray(shot?.characterIds)
    ? shot.characterIds.some((id) => !bindings.some((binding) => binding.kind === 'character' && binding.entityId === id)) || bindings.some((binding) => binding.kind === 'character' && !shot.characterIds.includes(binding.entityId))
    : Object.keys(project.characters || {}).length && !bindings.some((binding) => binding.kind === 'character')
  if (!bindings.some((binding) => binding.kind === 'location') || charactersMissing) {
    issues.push({ stage: 'assets', id: shotId, reason: '缺少角色／场景参考绑定' })
  }
  for (const binding of bindings) {
    const entity = project[binding.kind === 'character' ? 'characters' : 'locations']?.[binding.entityId]
    if (!entity || !String(entity.description || entity.appearance || entity.prompt || '').trim()
      || (images && !isPreparedImage(project, binding.assetId, preparationSignature(entity)))) issues.push({ stage: 'assets', id: binding.entityId, reason: '设定或参考素材缺失、未批准或与当前设定不一致' })
  }
  if (storyboard && !isPreparedImage(project, shot?.storyboardAssetId, shot && preparationSignature(shot))) {
    issues.push({ stage: 'storyboard', id: shotId, reason: '缺少当前分镜的已批准分镜图' })
  }
  return issues
}

export function assertProductionStages(project, shotId, options) {
  const issues = productionStageIssues(project, shotId, options)
  if (issues.length) throw new DomainValidationError(`production stages blocked: ${issues.map((issue) => `${issue.stage}:${issue.id} ${issue.reason}`).join('; ')}`, { issues })
}

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
  assertTimelineAssets(project, timeline.assetIds || [])
  if (Object.keys(project.sourceDocuments || {}).length) {
    const episodes = timeline.episodeId === project.id ? Object.values(project.episodes).filter((episode) => episode.id !== 'legacy-main') : [project.episodes[timeline.episodeId]].filter(Boolean)
    const shotIds = episodes.flatMap((episode) => episode.shotIds || [])
    if (!shotIds.length) throw new DomainValidationError('drama delivery is missing formal episodes')
    for (const shotId of shotIds) {
      assertProductionStages(project, shotId)
      if (!timeline.assetIds.includes(project.shots[shotId].approvedAssetId)) throw new DomainValidationError(`drama timeline is missing shot: ${shotId}`)
    }
  }
  assertRightsGate(project, 'deliver')
}
