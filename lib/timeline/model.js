export function timelineDuration(project, timeline) {
  return (timeline.assetIds || []).reduce((total, assetId) => total + Number(project.assets[assetId]?.media?.duration || 0), 0)
}

export function timelineGaps(project, timeline) {
  const gaps = []
  for (const [index, assetId] of (timeline.assetIds || []).entries()) {
    const asset = project.assets[assetId]
    if (!asset) gaps.push({ index, assetId, reason: 'missing' })
    else if (asset.status !== 'approved') gaps.push({ index, assetId, reason: `status:${asset.status}` })
  }
  return gaps
}
