import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const sessionPattern = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let workspaceTail = Promise.resolve()

export function linkStore(home, controller) {
  const file = join(home, 'storages', 'meiji', 'workspace-links.json')
  const workspaceFile = join(home, 'storages', 'workspace.json')
  const readMap = async () => {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      return data?.workspaces && typeof data.workspaces === 'object' ? data.workspaces : {}
    } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
  }
  const writeMap = async workspaces => {
    await mkdir(join(home, 'storages', 'meiji'), { recursive: true })
    const target = file
    await writeFile(target + '.tmp', JSON.stringify({ workspaces }, null, 2) + '\n', { mode: 0o600 })
    await rename(target + '.tmp', target)
  }
  return {
    async workspaceForSession(sessionId) {
      if (!sessionPattern.test(String(sessionId || ''))) return null
      let data
      try { data = JSON.parse(await readFile(workspaceFile, 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
      const tables = data?.tables?.workspaces
      if (!tables || typeof tables !== 'object') return null
      for (const [id, workspace] of Object.entries(tables)) {
        if (Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)) {
          return { id, title: typeof workspace.title === 'string' && workspace.title.trim() ? workspace.title.trim() : id }
        }
      }
      return null
    },
    async selectProject(sessionId, projectId, projects) {
      if (!sessionPattern.test(sessionId)) throw new Error('当前会话无效')
      await projects.read(projectId)
      const directory = join(home, 'storages', 'meiji', 'session-projects')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, sessionId + '.json'), JSON.stringify({ projectId }), { mode: 0o600 })
    },
    async projectForSession(sessionId) {
      if (sessionPattern.test(String(sessionId || ''))) {
        try {
          const selected = JSON.parse(await readFile(join(home, 'storages', 'meiji', 'session-projects', sessionId + '.json'), 'utf8'))
          const project = JSON.parse(await readFile(join(home, 'storages', 'meiji', 'projects', selected.projectId + '.json'), 'utf8'))
          return { workspace: { id: project.workspaceId, title: project.title }, projectId: project.id }
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      const workspace = await this.workspaceForSession(sessionId)
      if (!workspace) return { workspace: null, projectId: null }
      let projectId = (await readMap())[workspace.id] || null
      if (projectId) {
        try {
          const project = JSON.parse(await readFile(join(home, 'storages', 'meiji', 'projects', projectId + '.json'), 'utf8'))
          if (project.workspaceId !== workspace.id) projectId = null
        } catch (error) { if (error.code === 'ENOENT') projectId = null; else throw error }
      }
      return { workspace, projectId }
    },
    async ensureProject(projectId, projects) {
      const run = workspaceTail.then(async () => {
        if (!controller?.create || !controller?.rename) throw Object.assign(new Error('工作区服务不可用'), { status: 503 })
        const project = await projects.read(projectId)
        const path = join(home, 'storages', 'meiji', 'projects', project.id)
        await mkdir(path, { recursive: true })
        const { workspace } = await controller.create({ path })
        let title = project.title
        try {
          await controller.rename({ workspaceId: workspace.workspaceId, title })
        } catch (error) {
          if (!String(error.code || error.message).includes('name-conflict') && !String(error.message).includes('already in use')) throw error
          title = `${project.title} · ${project.id.slice(0, 8)}`
          await controller.rename({ workspaceId: workspace.workspaceId, title })
        }
        if (project.workspaceId !== workspace.workspaceId) {
          await projects.save(project.id, { workspaceId: workspace.workspaceId, workspacePath: path })
        }
        const workspaces = await readMap()
        workspaces[workspace.workspaceId] = project.id
        await writeMap(workspaces)
        return { workspace: { ...workspace, title }, projectId: project.id, title: project.title }
      })
      workspaceTail = run.catch(() => {})
      return run
    },
    async requireProject(sessionId, projectId) {
      const place = await this.projectForSession(sessionId)
      if (place.projectId !== projectId) throw Object.assign(new Error('请先从片库进入这部短剧的工作区'), { status: 409 })
      return place
    },
  }
}
