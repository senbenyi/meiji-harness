// 内容基线、版本快照与未发布草稿；沿用项目原子保存前准备、保存后发布的顺序。
import { randomUUID } from 'node:crypto'
import { deriveTaskStatus } from '../../shared/task-steps.js'
import { executionContext, activeStep } from '../runtime/task-context.js'
import { manualActions } from '../runtime/task-state.js'
import { recordStore, writeSteps } from './task-store.js'
import { markPendingReview } from '../../shared/content-state.js'
import { taskIdOfStep } from '../runtime/task-state.js'

const now = () => new Date().toISOString()
export async function addBaselines(store, project, operation, stage, baselines) {
  for (const target of contentTargets(project)) {
    if (!target.exists || (operation.episodeId && target.episodeId !== operation.episodeId) || target.key.split(':')[0] !== stage || (operation.track && target.key.includes(':') && target.key.split(':')[1] !== operation.track)) continue
    let source = target.node.source
    if (!source) {
      source = { artifactId: randomUUID(), version: 1, taskId: null, stepId: null }
      await store.update('artifacts', source.artifactId, { schemaVersion: 1, id: source.artifactId, ...source, projectId: project.id, episodeId: target.episodeId, target: target.key, content: target.content, createdAt: now(), published: true, baseline: true })
    }
    baselines.set(`${target.episodeId}:${target.key}`, source)
  }
}

const omitted = new Set(['revision', 'status', 'check', 'review', 'draft', 'operation', 'error', 'dependencies', 'stale', 'source', 'image', 'parts', 'localPath', 'assetId', 'assetCategory'])
const textData = value => JSON.parse(JSON.stringify(value, (key, item) => omitted.has(key) ? undefined : item))
export function contentTargets(project) {
  return project.episodes.flatMap(episode => {
    const storyChecks = [episode.plot.outline.check, episode.plot.characters.check, episode.plot.scenes.check, ...(episode.plot.props ? [episode.plot.props.check] : [])]
    const storyCheck = { passed: storyChecks.some(check => check.passed === false) ? false : storyChecks.every(check => check.passed === true) ? true : null,
      failures: [...new Set(storyChecks.flatMap(check => check.failures || []))] }
    const entries = [
      ['summary', episode.summary, { summary: episode.summary.content, durationSeconds: episode.durationSeconds }],
      ['story', episode.plot, { outline: episode.plot.outline.content, characters: textData(episode.plot.characters.items), scenes: textData(episode.plot.scenes.items), props: textData(episode.plot.props?.items || []) }],
      ['shots', episode.shots, episode.shots.items.map(shot => ({ id: shot.id, duration: shot.duration, content: shot.content, cast: shot.cast, scene: shot.scene, reference_images: shot.reference_images }))],
      ['seconds', episode.shots.seconds, episode.shots.items.map(shot => ({ id: shot.id, duration: shot.duration, content: shot.seconds.content }))],
      ['assembly', episode.assembly, episode.assembly.content],
      ...episode.shots.items.flatMap(shot => [['seconds', shot.seconds], ['storyboard', shot.storyboard], ['film', shot.video]].map(([kind, node]) => [`${kind}:${shot.id}`, node, kind === 'film' ? node.content?.file ? { file: node.content.file, url: node.content.url } : null : node.content])),
    ]
    return entries.map(([key, node, content]) => ({ episodeId: episode.id, key, node, content,
      check: key === 'story' ? storyCheck : node.check,
      exists: key === 'story' ? Boolean(content.outline || content.characters.length || content.scenes.length) : key === 'seconds' ? content.some(item => item.content) : key === 'shots' ? content.length > 0 : key === 'summary' ? Boolean(content.summary) : content != null }))
  })
}

// Snapshots are written before the project; published is set only after its atomic rename.
export async function prepareContentRecords(current, next) {
  const context = executionContext.getStore()
  if (!context) return []
  const oldTargets = new Map(contentTargets(current).map(item => [`${item.episodeId}:${item.key}`, item]))
  const saved = []
  for (const target of contentTargets(next)) {
    const old = oldTargets.get(`${target.episodeId}:${target.key}`)
    const changed = JSON.stringify(target.content) !== JSON.stringify(old?.content)
    if (!changed) {
      if (old?.node.source) target.node.source = structuredClone(old.node.source)
      if (target.node.source && target.check?.passed != null) {
        const output = context.outputs.find(item => item.artifactId === target.node.source.artifactId)
        if (output) output.reviewPassed = target.check.passed
      }
      continue
    }
    if (!target.exists) { delete target.node.source; continue }
    // 手动保存的剧集摘要视为已通过（由 episode-add/edit 写入），不重置为待审。
    if (manualActions.has(context.operation.action) && target.key !== 'summary') {
      const episode = next.episodes.find(item => item.id === target.episodeId)
      const nodes = target.key === 'story' ? [episode.plot.outline, episode.plot.characters, episode.plot.scenes, episode.plot.props].filter(Boolean) : [target.node]
      for (const node of nodes) markPendingReview(node)
      target.check = nodes[0].check
    }
    let previous = old?.node.source || context.baselines.get(`${target.episodeId}:${target.key}`) || null
    if (!previous && !old?.exists) {
      const history = (await context.store.list('artifacts')).filter(item => item.published && item.episodeId === target.episodeId && item.target === target.key).sort((a, b) => b.version - a.version)
      previous = history[0] ? { artifactId: history[0].id, version: history[0].version } : null
    }
    if (old?.exists && !previous) {
      previous = { artifactId: randomUUID(), version: 1, taskId: null, stepId: null }
      await context.store.update('artifacts', previous.artifactId, { schemaVersion: 1, id: previous.artifactId, ...previous, projectId: current.id, episodeId: target.episodeId, target: target.key, content: old.content, createdAt: now(), published: true, baseline: true })
    }
    const source = { taskId: taskIdOfStep(context, context.stepId), stepId: context.stepId || null, artifactId: randomUUID(), version: (previous?.version || 0) + 1 }
    await context.store.update('artifacts', source.artifactId, { schemaVersion: 1, id: source.artifactId, ...source, projectId: current.id, episodeId: target.episodeId, target: target.key, previousArtifactId: previous?.artifactId || null, content: target.content, createdAt: now(), published: false })
    target.node.source = source
    saved.push({ ...source, episodeId: target.episodeId, target: target.key, reviewPassed: target.check?.passed ?? null })
  }
  return saved
}
export async function commitContentRecords(saved) {
  const context = executionContext.getStore()
  if (!context || !saved.length) return
  for (const item of saved) {
    await context.store.update('artifacts', item.artifactId, artifact => ({ ...artifact, published: true }))
    const index = context.outputs.findIndex(value => value.episodeId === item.episodeId && value.target === item.target)
    if (index < 0) context.outputs.push(item); else context.outputs[index] = item
  }
  const step = context.steps.find(value => value.id === context.stepId)
  if (step) step.outputs = [...step.outputs, ...saved.map(item => item.artifactId)]
  await writeSteps(context, task => ({ episodeId: task.episodeId || saved[0].episodeId, artifacts: [...task.artifacts, ...saved] }))
}

// 不发布的弹框草稿及未通过结构校验的生成原文沿用任务 artifact 与 outputs，不写项目或剧集。
export async function saveTaskDraft(target, content) {
  const context = executionContext.getStore()
  if (!context) throw new Error('草稿需要任务上下文')
  const id = randomUUID()
  const source = { artifactId: id, taskId: taskIdOfStep(context, context.stepId), stepId: context.stepId, episodeId: context.operation.episodeId || null, target, version: 1, reviewPassed: content.check?.passed ?? null }
  await context.store.update('artifacts', id, { schemaVersion: 1, id, ...source, projectId: context.projectId, content, createdAt: now(), published: false })
  context.outputs.push(source)
  activeStep().outputs.push(id)
  await writeSteps(context, task => ({ artifacts: [...task.artifacts, source] }))
}

export async function readTaskDraft(home, task) {
  if (task.action !== 'episode-summary-draft' || !['completed', 'review_failed'].includes(deriveTaskStatus(task.steps))) return {}
  const output = task.latestOutputs.find(item => item.target === 'summary-draft')
  if (!output) return {}
  const artifact = await recordStore(home, task.projectId).read('artifacts', output.artifactId)
  return { draft: artifact.content }
}
