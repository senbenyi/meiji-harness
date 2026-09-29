import { prepareContentRecords, commitContentRecords, recordStore, contentTargets } from './task-store.js'
import { notifyProject } from './project-events.js'
import { GenerationStatus, schemaVersion, node, assertDrama, targetNode, saveReview, allNodes, saveTextDraft, refreshReferences, aggregateStatus } from '../../shared/drama-model.js'
import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { replaceFrom, sourcePatch, aspectRatioOf, durationOf } from '../../shared/project-rules.js'
import { normalizeProject } from './episodes.js'
import { episodeSnapshot, projectIds, readProjectFile, removeProjectFiles, writeProjectFile } from './project-files.js'

const writes = new Map()

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function validateProject(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  const summary = typeof input?.summary === 'string' ? input.summary.trim() : ''
  const script = typeof input?.script === 'string' ? input.script.trim() : ''
  if (!title || title.length > 100) throw new Error('短剧标题需为 1–100 字')
  if (!summary || summary.length > 10000) throw new Error('剧本摘要需为 1–10000 字')
  if (script.length > 200000) throw new Error('剧本过长')
  const style = typeof input?.style === 'string' ? input.style.trim() : ''
  if (style.length > 120) throw new Error('风格需为 1–120 字')
  const fields = { title, summary, script, style, aspectRatio: aspectRatioOf(input?.aspectRatio) }
  if (input?.durationSeconds != null && input.durationSeconds !== '') fields.durationSeconds = durationOf(input.durationSeconds)
  return fields
}

export function projectStore(home) {
  const root = join(resolve(home), 'storages', 'meiji', 'projects')
  const fileFor = id => join(root, id + '.json')
  const parse = async id => {
    const project = normalizeProject(await readProjectFile(home, id))
    if (project?.id !== id || typeof project.createdAt !== 'string') throw new Error('项目文件损坏')
    return project
  }
  return {
    async interruptRecords(id) {
      const history = recordStore(home, id)
      await history.interrupt()
      for (const target of contentTargets(await this.read(id))) if (target.node.source) {
        const artifact = await history.read('artifacts', target.node.source.artifactId)
        if (!artifact.published) await history.update('artifacts', artifact.id, { ...artifact, published: true })
      }
    },
    async list() {
      const projects = []
      for (const id of await projectIds(home)) {
        try { projects.push(await parse(id)) }
        catch (error) { if (error instanceof SyntaxError || error.message === '项目文件损坏') continue; throw error }
      }
      return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async read(id) {
      if (!uuid.test(id)) throw Object.assign(new Error('项目 ID 无效'), { status: 400 })
      try { return await parse(id) }
      catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('项目不存在'), { status: 404 })
        throw error
      }
    },
    async create(input) {
      const fields = validateProject(input)
      const now = new Date().toISOString()
      const project = normalizeProject({
        schemaVersion,
        revision: 0,
        id: randomUUID(),
        ...fields,
        status: GenerationStatus.NOT_GENERATED,
        lifecycle: 'in-progress',
        summary: { ...node('summary', fields.summary), status: GenerationStatus.PASSED, check: { passed: true, failures: [], revision: 0 } },
        episodes: [],
        stage: 'summary',
        workflow: 'h3',
        createdAt: now,
        updatedAt: now,
      })
      await mkdir(root, { recursive: true })
      await writeProjectFile(home, project, null)
      return project
    },
    async save(id, patch, { expectedRevision } = {}) {
      const key = fileFor(id)
      const previous = writes.get(key) || Promise.resolve()
      const job = previous.catch(() => {}).then(async () => {
        const current = await this.read(id)
        const before = episodeSnapshot(current)
        if (expectedRevision !== undefined && (current.revision || 0) !== expectedRevision) {
          throw Object.assign(new Error('项目已被修改，请刷新后重试，旧结果未覆盖当前数据'), { status: 409 })
        }
        const changes = typeof patch === 'function' ? await patch(current) : patch
        if (changes == null) return current
        const next = assertDrama({ ...current, ...changes, id: current.id, schemaVersion,
          revision: (current.revision || 0) + 1, createdAt: current.createdAt, updatedAt: new Date().toISOString() })
        for (const episode of next.episodes) {
          const previous = current.episodes.find(e => e.id === episode.id)
          if (!previous) continue
          for (const target of allNodes(episode)) {
            const old = targetNode(previous, target.id)
            if (old && old.review.revision > target.review.revision) target.review = structuredClone(old.review)
            if (old && old.draft.revision > target.draft.revision) target.draft = structuredClone(old.draft)
          }
        }
        for (const episode of next.episodes) refreshReferences(episode)
        next.status = aggregateStatus(next.episodes)
        const savedRecords = await prepareContentRecords(current, next)
        await writeProjectFile(home, next, before)
        await commitContentRecords(savedRecords)
        notifyProject(home, next.id, next.revision)
        return next
      })
      writes.set(key, job)
      try { return await job }
      finally { if (writes.get(key) === job) writes.delete(key) }
    },
    async remove(id) {
      await this.read(id)
      const key = fileFor(id)
      const job = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        await this.read(id)
        await rm(join(root, id, 'history'), { recursive: true, force: true })
        await rm(join(root, id, 'films'), { recursive: true, force: true })
        await removeProjectFiles(home, id)
        notifyProject(home, id)
      })
      writes.set(key, job)
      try { await job }
      finally { if (writes.get(key) === job) writes.delete(key) }
    },
    async saveReviewDraft(id, episodeId, key, text, revision, kind = 'review') {
      return this.save(id, current => {
        const next = structuredClone(current)
        const episode = next.episodes.find(e => e.id === episodeId)
        const target = episode && targetNode(episode, key)
        if (!target) throw Object.assign(new Error('修改意见目标不存在'), { status: 404 })
        if (kind === 'text') saveTextDraft(target, text, revision)
        else saveReview(target, text, revision)
        return next
      })
    },
    async writeStep(id, step, data) {
      return this.save(id, current => replaceFrom(current, step, data))
    },
    async saveSource(id, input) {
      return this.save(id, current => sourcePatch(current, input))
    },
  }
}

// Compare only business inputs within the task scope. Draft opinions do not invalidate generation.
export function revisionStore(store, operationId, scope = {}) {
  const observed = new Map()
  const fingerprint = project => {
    const episode = scope.episodeId ? project.episodes.find(e => e.id === scope.episodeId) : null
    const index = episode?.shots.items.findIndex(shot => shot.id === scope.track) ?? -1
    const textTask = ['shot-seconds', 'shot-storyboard', 'revise-shot', 'storyboard-text'].includes(scope.action)
    const continuity = episode?.shots.items.map((shot, i) => ({
      id: shot.id, duration: shot.duration, content: shot.content,
      ...(textTask && Math.abs(i - index) === 1 && shot.seconds.check.passed === true && !shot.seconds.stale ? { seconds: shot.seconds.content } : {}),
      ...(['shot-storyboard', 'storyboard-text'].includes(scope.action) && i === index - 1 ? { storyboard: shot.storyboard } : {}),
      ...(scope.action === 'film' && i === index - 1 ? { video: shot.video } : {}),
    }))
    const value = episode && scope.track ? { summary: episode.summary, durationSeconds: episode.durationSeconds, plot: episode.plot, shot: episode.shots.items[index], ...((textTask || scope.action === 'film') ? { continuity } : {}) } : episode || project
    return JSON.stringify({ title: project.title, script: project.script, durationSeconds: project.durationSeconds, style: project.style, language: project.outputLanguage, aspectRatio: project.aspectRatio, value }, (key, value) => ['source', 'review', 'draft', 'operation', 'status', 'activity', 'activeOperation', 'updatedAt', 'activityError', 'revision', 'skills'].includes(key) ? undefined : value)
  }
  const guarded = Object.create(store)
  guarded.read = async id => {
    const current = await store.read(id)
    const mark = fingerprint(current)
    if (observed.has(id) && observed.get(id) !== mark) throw Object.assign(new Error('任务依赖已修改，旧结果未覆盖当前数据'), { status: 409 })
    observed.set(id, mark)
    return current
  }
  guarded.save = async (id, patch) => {
    if (!observed.has(id)) await guarded.read(id)
    const saved = await store.save(id, async current => {
      if (observed.get(id) !== fingerprint(current)) throw Object.assign(new Error('任务依赖已修改，旧结果未覆盖当前数据'), { status: 409 })
      const changes = typeof patch === 'function' ? await patch(current) : patch
      return changes == null ? null : { ...changes, ...(operationId && Object.hasOwn(changes, 'activity') ? { activeOperation: changes.activity ? operationId : null } : {}) }
    })
    observed.set(id, fingerprint(saved))
    return saved
  }
  return guarded
}
