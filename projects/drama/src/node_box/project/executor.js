import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { ProjectModel } from '../../project_runtime/project_model.js'
import { createProject } from './create_project.js'

/** 创建业务步骤；由ProjectService校验输入并在共享队列内调用，与AI Tool接口无关。 */
export class CreateProjectExecutor {
  constructor({ root, workspaceController, sessionController, readBindings, saveBindings, applyMainAgent, onCreated }) {
    Object.assign(this, { root, workspaceController, sessionController, readBindings, saveBindings, applyMainAgent, onCreated })
  }

  async execute(info, { sessionId: sourceSessionId, requestId }) {
    const state = await this.readBindings()
    const key = JSON.stringify([sourceSessionId, requestId])
    let row = state.requests[key]
    if (row?.deleted_at) throw Object.assign(new Error('项目已删除，请使用新的创建请求'), { code: 'PROJECT_DELETED' })
    if (row && JSON.stringify(row.info) !== JSON.stringify(info)) throw new Error('同一请求ID不能用于不同项目资料')
    if (!row) {
      row = state.requests[key] = { project_id: `p_${randomUUID()}`, info }
      await this.saveBindings(state)
    }
    const directory = join(this.root, 'projects', row.project_id)
    const file = join(directory, 'project.json')
    let manager
    try { manager = await ProjectManager.open(file) }
    catch (error) {
      if (error.code !== 'INVALID_PROJECT' || error.message !== 'file：项目文件不存在') throw error
      manager = new ProjectManager(new ProjectModel(file, await createProject(info, row.project_id)))
      await manager.model.update()
    }
    if (!row.workspace) {
      const { workspace } = await this.workspaceController.create({ path: directory })
      row.workspace = { id: workspace.workspaceId, path: directory }
      await this.saveBindings(state)
    }
    await this.workspaceController.rename({ workspaceId: row.workspace.id, title: manager.read().basic_info.name })
    if (!row.session_id) {
      row.pending_session_id ??= `session-${randomUUID()}`
      await this.saveBindings(state)
      row.session_id = (await this.sessionController.create({ sessionId: row.pending_session_id, workspaceId: row.workspace.id, agentPreset: 'standard' })).sessionId
      state.sessions[row.session_id] = row.project_id
      await this.saveBindings(state)
    }
    if (this.applyMainAgent) await this.applyMainAgent(row.session_id)
    const result = { project_id: row.project_id, session_id: row.session_id, workspace: row.workspace }
    this.onCreated({ source_session_id: sourceSessionId, ...result })
    return result
  }
}
