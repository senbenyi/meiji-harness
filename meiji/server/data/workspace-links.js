import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readProjectFile } from './project-files.js'

const sessionPattern = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let workspaceTail = Promise.resolve()

export function linkStore(home, controller) {
  return {
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
          const project = await readProjectFile(home, selected.projectId)
          return { workspace: { id: project.workspaceId, title: project.title }, projectId: project.id }
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      return { workspace: null, projectId: null }
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
        return { workspace: { ...workspace, title }, projectId: project.id, title: project.title }
      })
      workspaceTail = run.catch(() => {})
      return run
    },
    async requireProject(sessionId, projectId) {
      const place = await this.projectForSession(sessionId)
      if (place.projectId !== projectId) throw Object.assign(new Error('请先在当前会话创建或打开这部短剧'), { status: 409 })
      return place
    },
  }
}
