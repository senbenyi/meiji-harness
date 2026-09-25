import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { replaceFrom, sourcePatch, aspectRatioOf, durationOf } from '../flow/gates.js'
import { normalizeProject } from './episodes.js'

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
  const parse = async (id, file) => {
    const project = normalizeProject(JSON.parse(await readFile(file, 'utf8')))
    if (project?.id !== id || typeof project.createdAt !== 'string') throw new Error('项目文件损坏')
    return project
  }
  return {
    async list() {
      let files
      try { files = await readdir(root) }
      catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const projects = []
      for (const file of files) {
        const id = file.endsWith('.json') ? file.slice(0, -5) : ''
        if (!uuid.test(id)) continue
        try { projects.push(await parse(id, join(root, file))) }
        catch (error) { if (error instanceof SyntaxError || error.message === '项目文件损坏') continue; throw error }
      }
      return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async read(id) {
      if (!uuid.test(id)) throw Object.assign(new Error('项目 ID 无效'), { status: 400 })
      try { return await parse(id, fileFor(id)) }
      catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('项目不存在'), { status: 404 })
        throw error
      }
    },
    async create(input) {
      const fields = validateProject(input)
      const now = new Date().toISOString()
      const project = normalizeProject({
        version: 1,
        revision: 0,
        id: randomUUID(),
        ...fields,
        status: 'in-progress',
        episodes: [],
        stage: 'brief',
        workflow: 'h3',
        feedback: {},
        brief: null,
        outline: null,
        characters: null,
        scenes: null,
        shots: null,
        storyboard: null,
        films: {},
        createdAt: now,
        updatedAt: now,
      })
      await mkdir(root, { recursive: true })
      const target = fileFor(project.id)
      await writeFile(target + '.tmp', JSON.stringify(project, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(target + '.tmp', target)
      return project
    },
    async save(id, patch, { expectedRevision } = {}) {
      const key = fileFor(id)
      const previous = writes.get(key) || Promise.resolve()
      const job = previous.catch(() => {}).then(async () => {
        const current = await this.read(id)
        if (expectedRevision !== undefined && (current.revision || 0) !== expectedRevision) {
          throw Object.assign(new Error('项目已被修改，请刷新后重试，旧结果未覆盖当前数据'), { status: 409 })
        }
        const changes = typeof patch === 'function' ? await patch(current) : patch
        if (changes == null) return current
        const next = normalizeProject({ ...current, ...changes, id: current.id, version: current.version,
          revision: (current.revision || 0) + 1, createdAt: current.createdAt, updatedAt: new Date().toISOString() })
        const temporary = key + '.' + randomUUID() + '.tmp'
        try {
          await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
          await rename(temporary, key)
        } finally { await rm(temporary, { force: true }) }
        return next
      })
      writes.set(key, job)
      try { return await job }
      finally { if (writes.get(key) === job) writes.delete(key) }
    },
    async writeStep(id, step, data) {
      return this.save(id, current => replaceFrom(current, step, data))
    },
    async saveSource(id, input) {
      return this.save(id, current => sourcePatch(current, input))
    },
  }
}

// An operation may commit only against the project revision it has observed.
export function revisionStore(store, operationId) {
  const revisions = new Map()
  const guarded = Object.create(store)
  guarded.read = async id => {
    const current = await store.read(id)
    const revision = current.revision || 0
    if (revisions.has(id) && revisions.get(id) !== revision) throw Object.assign(new Error('项目已被修改，旧任务已停止，请刷新后重试'), { status: 409 })
    revisions.set(id, revision)
    return current
  }
  guarded.save = async (id, patch) => {
    if (!revisions.has(id)) await guarded.read(id)
    const saved = await store.save(id, current => {
      const changes = typeof patch === 'function' ? patch(current) : patch
      return { ...changes, ...(operationId && Object.hasOwn(changes, 'activity') ? { activeOperation: changes.activity ? operationId : null } : {}) }
    }, { expectedRevision: revisions.get(id) })
    revisions.set(id, saved.revision)
    return saved
  }
  return guarded
}
