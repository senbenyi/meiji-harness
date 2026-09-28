import { assertDrama } from '../../client/drama-model.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

export const executionContext = new AsyncLocalStorage()
const writes = new Map()
const validId = /^[a-zA-Z0-9_-]+$/
const now = () => new Date().toISOString()
const tracked = new Set(['episode-generate', 'episode-add', 'episode-edit', 'source', 'outline', 'outline-text', 'characters', 'scenes', 'scene-text', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'storyboard', 'shot-storyboard', 'shot-boards', 'storyboard-text', 'shot-assets', 'film', 'films', 'assemble'])
export const manualActions = new Set(['episode-add', 'episode-edit', 'source', 'outline-text', 'scene-text', 'storyboard-text', 'shot-assets'])

export function recordStore(home, projectId) {
  if (!validId.test(projectId || '')) throw new Error('项目 ID 无效')
  const root = join(home, 'storages', 'meiji', 'projects', projectId, 'history')
  const path = (kind, id) => {
    if (!validId.test(id || '')) throw new Error('记录 ID 无效')
    return join(root, kind, id + '.json')
  }
  const read = (kind, id) => readFile(path(kind, id), 'utf8').then(JSON.parse)
  const update = async (kind, id, change) => {
    const file = path(kind, id)
    const job = (writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      let current = null
      try { current = await read(kind, id) } catch (error) { if (error.code !== 'ENOENT') throw error }
      const next = typeof change === 'function' ? change(current) : change
      await mkdir(join(root, kind), { recursive: true })
      const temp = file + '.' + randomUUID() + '.tmp'
      try { await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 }); await rename(temp, file) }
      finally { await rm(temp, { force: true }) }
      return next
    })
    writes.set(file, job)
    try { return await job } finally { if (writes.get(file) === job) writes.delete(file) }
  }
  return {
    read, update,
    async list(kind = 'tasks') {
      let names
      try { names = await readdir(join(root, kind)) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      return Promise.all(names.filter(name => name.endsWith('.json')).map(name => read(kind, name.slice(0, -5))))
    },
    async removeEpisode(episodeId) {
      for (const kind of ['tasks', 'artifacts']) for (const value of await this.list(kind)) {
        if (value.episodeId === episodeId) await rm(path(kind, value.id), { force: true })
      }
    },
    async interrupt() {
      for (const task of await this.list()) if (task.status === 'running') await update('tasks', task.id, current => ({ ...current, status: 'interrupted', endedAt: now(), nodes: current.nodes.map(node => node.status === 'running' ? { ...node, status: 'interrupted', endedAt: now() } : node) }))
    },
  }
}

export async function startExecution(home, operation, id) {
  if (!operation.projectId || !tracked.has(operation.action)) return null
  const store = recordStore(home, operation.projectId)
  const project = assertDrama(JSON.parse(await readFile(join(home, 'storages', 'meiji', 'projects', operation.projectId + '.json'), 'utf8')))
  const nodeId = randomUUID()
  await store.update('tasks', id, { schemaVersion: 1, id, projectId: operation.projectId, episodeId: operation.episodeId || null,
    action: operation.action, source: operation.origin || 'api', actor: manualActions.has(operation.action) ? 'human' : 'model', sessionId: operation.sessionId || null,
    mode: operation.mode || operation.generationMode || (manualActions.has(operation.action) ? 'edit' : 'generate'), requirements: operation.requirements || '', opinion: operation.review || operation.instruction || '',
    status: 'running', startedAt: now(), endedAt: null, nodes: [{ id: nodeId, kind: 'execute', status: 'running', startedAt: now(), endedAt: null, inputs: [], outputs: [] }], artifacts: [], error: null })

  const stage = { 'episode-generate': 'summary', 'episode-edit': 'summary', 'episode-add': 'summary', source: 'summary', outline: 'story', 'outline-text': 'story', characters: 'story', scenes: 'story', 'scene-text': 'story', shots: 'shots', 'revise-shot': 'shots', seconds: 'seconds', 'shot-seconds': 'seconds', storyboard: 'storyboard', 'shot-storyboard': 'storyboard', 'shot-boards': 'storyboard', 'storyboard-text': 'storyboard', film: 'film', films: 'film', assemble: 'assembly' }[operation.action]
  const baselines = new Map()
  for (const target of contentTargets(project)) {
    if (!target.exists || (operation.episodeId && target.episodeId !== operation.episodeId) || target.key.split(':')[0] !== stage || (operation.track && target.key.includes(':') && target.key.split(':')[1] !== operation.track)) continue
    let source = target.node.source
    if (!source) {
      source = { artifactId: randomUUID(), version: 1, taskId: null, nodeId: null }
      await store.update('artifacts', source.artifactId, { schemaVersion: 1, id: source.artifactId, ...source, projectId: project.id, episodeId: target.episodeId, target: target.key, content: target.content, createdAt: now(), published: true, baseline: true })
    }
    baselines.set(`${target.episodeId}:${target.key}`, source)
  }
  await store.update('tasks', id, task => ({ ...task, nodes: task.nodes.map(node => ({ ...node, inputs: [...baselines.values()].map(value => value.artifactId) })) }))
  return { store, taskId: id, nodeId, operation, stage, baselines, outputs: [], signal: null }
}

export async function endExecution(context, error, signal) {
  if (!context) return
  await context.store.update('tasks', context.taskId, task => {
    const failedNode = task.nodes.find(node => ['failed', 'cancelled', 'interrupted'].includes(node.status))
    const reviews = task.nodes.filter(node => node.reviewResult)
    const latest = new Map(reviews.flatMap(node => (node.inputs.length ? node.inputs : [node.target || node.kind]).map(id => [id, node.reviewResult])))
    const status = signal?.aborted ? signal.reason?.code === 'TASK_PAUSED' ? 'interrupted' : 'cancelled'
      : error || failedNode ? error?.code === 'CONTENT_CHECK_FAILED' ? 'review_failed' : 'failed'
      : context.outputs.some(item => item.reviewPassed === false) ? 'review_failed'
      : [...latest.values()].includes('fail') && !context.outputs.length ? 'review_failed' : 'completed'
    return { ...task, status, latestOutputs: context.outputs, endedAt: now(), error: error?.message || failedNode?.error || null,
      nodes: task.nodes.map(node => node.kind === 'execute' ? { ...node, status: ['completed', 'review_failed'].includes(status) ? 'succeeded' : status, endedAt: now() } : node) }
  })
}

export async function recordedNode(kind, run, detail = {}) {
  const parent = executionContext.getStore()
  if (!parent) return run()
  const id = randomUUID()
  const target = detail.track && !['seconds', 'shots'].includes(parent.stage) ? `${parent.stage}:${detail.track}` : detail.target
  const outputs = target ? parent.outputs.filter(item => item.target === target) : parent.outputs
  const baselines = [...parent.baselines.entries()].filter(([key]) => !target || key.endsWith(':' + target)).map(([, value]) => value)
  const inputs = [...new Set((outputs.length ? outputs : baselines).map(item => item.artifactId))]
  await parent.store.update('tasks', parent.taskId, task => ({ ...task, nodes: [...task.nodes, { id, kind, status: 'running', startedAt: now(), endedAt: null, inputs, outputs: [], ...detail, ...(target ? { target } : {}) }] }))
  return executionContext.run({ ...parent, nodeId: id, kind }, async () => {
    try {
      const result = await run()
      await parent.store.update('tasks', parent.taskId, task => ({ ...task, nodes: task.nodes.map(node => node.id === id ? { ...node, status: 'succeeded', endedAt: now(), ...(result?.check ? { reviewResult: result.check.passed ? 'pass' : 'fail', reasons: result.check.failures } : {}) } : node) }))
      return result
    } catch (error) {
      const status = parent.signal?.aborted ? parent.signal.reason?.code === 'TASK_PAUSED' ? 'interrupted' : 'cancelled' : 'failed'
      await parent.store.update('tasks', parent.taskId, task => ({ ...task, nodes: task.nodes.map(node => node.id === id ? { ...node, status, error: error.message, endedAt: now() } : node) }))
      throw error
    }
  })
}

const omitted = new Set(['revision', 'status', 'check', 'review', 'draft', 'operation', 'error', 'dependencies', 'stale', 'source', 'image', 'parts', 'localPath', 'imageUrl', 'assetId', 'assetCategory'])
const textData = value => JSON.parse(JSON.stringify(value, (key, item) => omitted.has(key) ? undefined : item))
export function contentTargets(project) {
  return project.episodes.flatMap(episode => {
    const entries = [
      ['summary', episode.summary, { summary: episode.summary.content, durationSeconds: episode.durationSeconds }],
      ['story', episode.plot, { outline: episode.plot.outline.content, characters: textData(episode.plot.characters.items), scenes: textData(episode.plot.scenes.items) }],
      ['shots', episode.shots, episode.shots.items.map(shot => ({ id: shot.id, duration: shot.duration, content: shot.content, cast: shot.cast, scene: shot.scene, reference_images: shot.reference_images }))],
      ['seconds', episode.shots.seconds, episode.shots.items.map(shot => ({ id: shot.id, duration: shot.duration, content: shot.seconds.content }))],
      ['assembly', episode.assembly, episode.assembly.content],
      ...episode.shots.items.flatMap(shot => [['storyboard', shot.storyboard], ['film', shot.video]].map(([kind, node]) => [`${kind}:${shot.id}`, node, kind === 'film' ? node.content?.file ? { file: node.content.file, url: node.content.url } : null : node.content])),
    ]
    return entries.map(([key, node, content]) => ({ episodeId: episode.id, key, node, content,
      check: key === 'story' ? episode.plot.outline.check : node.check,
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
    if (manualActions.has(context.operation.action)) {
      const episode = next.episodes.find(item => item.id === target.episodeId)
      const nodes = target.key === 'story' ? [episode.plot.outline, episode.plot.characters, episode.plot.scenes] : [target.node]
      for (const node of nodes) { node.check = { passed: null, failures: [], revision: node.revision }; if (!node.operation) node.status = 'not-generated' }
      target.check = nodes[0].check
    }
    let previous = old?.node.source || context.baselines.get(`${target.episodeId}:${target.key}`) || null
    if (!previous && !old?.exists) {
      const history = (await context.store.list('artifacts')).filter(item => item.published && item.episodeId === target.episodeId && item.target === target.key).sort((a, b) => b.version - a.version)
      previous = history[0] ? { artifactId: history[0].id, version: history[0].version } : null
    }
    if (old?.exists && !previous) {
      previous = { artifactId: randomUUID(), version: 1, taskId: null, nodeId: null }
      await context.store.update('artifacts', previous.artifactId, { schemaVersion: 1, id: previous.artifactId, ...previous, projectId: current.id, episodeId: target.episodeId, target: target.key, content: old.content, createdAt: now(), published: true, baseline: true })
    }
    const source = { taskId: context.taskId, nodeId: context.nodeId, artifactId: randomUUID(), version: (previous?.version || 0) + 1 }
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
  await context.store.update('tasks', context.taskId, task => ({ ...task, episodeId: task.episodeId || saved[0].episodeId,
    artifacts: [...task.artifacts, ...saved], nodes: task.nodes.map(node => node.id === context.nodeId ? { ...node, outputs: [...node.outputs, ...saved.map(item => item.artifactId)] } : node) }))
}
