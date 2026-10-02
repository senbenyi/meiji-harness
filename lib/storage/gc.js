export function referencedLogicalKeys(project) {
  const keys = new Set()
  for (const asset of Object.values(project.assets || {})) if (asset.logicalKey) keys.add(asset.logicalKey)
  for (const deliverable of Object.values(project.deliverables || {})) if (deliverable.logicalKey) keys.add(deliverable.logicalKey)
  for (const rights of Object.values(project.rightsRecords || {})) {
    for (const assetId of rights.evidenceAssetIds || []) {
      const asset = project.assets?.[assetId]
      if (asset?.logicalKey) keys.add(asset.logicalKey)
    }
  }
  return keys
}

export function canCollectAsset(project, assetId) {
  const asset = project.assets?.[assetId]
  if (!asset || !asset.logicalKey) return false
  if (asset.status === 'approved') return false
  if (Object.values(project.timelines || {}).some((timeline) => timeline.assetIds?.includes(assetId))) return false
  if (Object.values(project.deliverables || {}).some((item) => item.assetIds?.includes(assetId))) return false
  if (Object.values(project.rightsRecords || {}).some((item) => item.evidenceAssetIds?.includes(assetId))) return false
  return ['rejected', 'invalidated', 'archived'].includes(asset.status)
}
