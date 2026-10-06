import { DomainValidationError } from '../domain/errors.js'
import { assertProductionStages } from '../domain/policies.js'

// A rework run targets one production stage; assembly reuses approved shot media.
export function reworkTasks(project, { runId, kind, id, input }) {
  if (['analysis', 'outline', 'script'].includes(kind)) {
    const ids = kind === 'script' && !id ? Object.values(project.episodes).filter((ep) => ep.id !== 'legacy-main').map((ep) => ep.id) : [id || project.id]
    if (!ids.length) throw new DomainValidationError('请先完成分集规划')
    return ids.map((scopeId) => ({ id: `${runId}:text:${scopeId}`, kind: 'revise-text', scopeId, input: { ...input, kind, id: scopeId, label: kind === 'analysis' ? 'story-reconcile' : kind === 'outline' ? 'episode-plan' : `episode-script:${scopeId}` }, dependencies: [] }))
  }
  const episodes = Object.values(project.episodes).filter((ep) => ep.id !== 'legacy-main').sort((a, b) => (a.order || 0) - (b.order || 0))
  const shots = id && project.shots[id] ? [project.shots[id]] : episodes.filter((ep) => !id || ep.id === id).flatMap((ep) => ep.shotIds.map((shotId) => project.shots[shotId]))
  const tasks = []
  if (['character', 'location', 'assets'].includes(kind)) {
    const entities = kind === 'assets' ? [...Object.values(project.characters).map((e) => ['character', e]), ...Object.values(project.locations).map((e) => ['location', e])] : [[kind, project[kind === 'character' ? 'characters' : 'locations'][id]]]
    for (const [type, entity] of entities) {
      if (!entity) throw new DomainValidationError('设定不存在')
      tasks.push({ id: `${runId}:${type}:${entity.id}`, kind: 'render-reference', scopeId: entity.id, dependencies: [], input: { ...input, preparationKind: type, entityId: entity.id } })
    }
  } else if (['storyboard', 'video', 'media'].includes(kind)) {
    for (const shot of shots) {
      assertProductionStages(project, shot.id, { storyboard: kind !== 'storyboard' })
      tasks.push({ id: `${runId}:${shot.id}`, kind: kind === 'storyboard' ? 'render-storyboard' : 'render-shot', scopeId: shot.id, dependencies: [], input: { ...input, preparationKind: 'storyboard', entityId: shot.id, nodeId: shot.id, title: shot.title, prompt: shot.prompt, capability: 'video.reference2video' } })
    }
  } else if (kind === 'delivery') {
    const outputs = []
    for (const episode of episodes) {
      for (const shotId of episode.shotIds) {
        assertProductionStages(project, shotId)
        const asset = project.assets[project.shots[shotId].approvedAssetId]
        if (asset?.kind !== 'video' || asset.status !== 'approved') throw new DomainValidationError('请先生成本项目所有有效镜头视频')
      }
      const taskId = `${runId}:concat:${episode.id}`
      const nodeId = `${runId}:episode:${episode.id}`
      tasks.push({ id: taskId, kind: 'concat-video', scopeId: episode.id, dependencies: [], input: { ...input, nodes: episode.shotIds, nodeId, episodeId: episode.id, title: `${episode.title}-成片`, group: '成片', strategy: project.productionSpec.assemblyStrategy || 'preserve' } })
      outputs.push({ taskId, nodeId })
    }
    tasks.push({ id: `${runId}:delivery`, kind: 'deliver-drama', scopeId: project.id, dependencies: outputs.map((o) => o.taskId), input: { ...input, nodes: outputs.map((o) => o.nodeId), nodeId: `${runId}:final`, title: `${project.title}-成片`, group: '成片', strategy: project.productionSpec.assemblyStrategy || 'preserve' } })
  } else throw new DomainValidationError('不支持的重新生成步骤')
  if (!tasks.length || (kind === 'delivery' && !episodes.length)) throw new DomainValidationError('没有可处理的内容，请先完成上一步')
  return tasks
}
