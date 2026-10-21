import { editProject } from './edit_project.js'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { CreateProjectExecutor } from './executor.js'
import { projectInfo } from './create_project.js'
import { NodeStateModel } from '@agent-modules/task/models'
import { createWriteQueue } from '../../project_runtime/write_queue.js'
import { scriptFingerprint, expireScriptDependents } from '../script_revision/state.js'

/** 会话与面板共用项目服务：绑定、事件和创建/编辑/删除共享串行队列。 */
export class ProjectService extends EventEmitter {
  #creator

  constructor({ root, workspaceController, sessionController }) {
    super()
    this.writes = createWriteQueue()
    this.root = root
    this.workspaceController = workspaceController
    this.sessionController = sessionController
    this.#creator = new CreateProjectExecutor({
      root, workspaceController, sessionController,
      readBindings: () => this.#readBindings(),
      saveBindings: state => this.#saveBindings(state),
      applyMainAgent: sessionId => this.applyMainAgent?.(sessionId),
      onCreated: event => this.emit('created', event),
    })
  }

  async #readBindings() {
    try {
      const state = JSON.parse(await readFile(join(this.root, 'bindings.json'), 'utf8'))
      return { draft_requests: {}, ...state }
    }
    catch (error) { if (error.code === 'ENOENT') return { sessions: {}, requests: {}, draft_requests: {} }; throw error }
  }

  async #saveBindings(state) {
    await mkdir(this.root, { recursive: true })
    const temp = join(this.root, `.bindings-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(temp, join(this.root, 'bindings.json'))
    } finally { await rm(temp, { force: true }) }
  }

  /** 无工作区时建立独立会话；请求ID跨重启复用同一会话。 */
  startSession(requestId) {
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId))
      return Promise.reject(new TypeError('需提供有效的会话创建请求ID'))
    return this.writes.run(async () => {
      const state = await this.#readBindings()
      let sessionId = state.draft_requests[requestId]
      if (!sessionId) {
        sessionId = `session-${randomUUID()}`
        state.draft_requests[requestId] = sessionId
        await this.#saveBindings(state)
      }
      const cwd = join(this.root, 'sessions', sessionId)
      await mkdir(cwd, { recursive: true })
      await this.sessionController.create({ sessionId, cwd, agentPreset: 'standard' })
      if (this.applyMainAgent) await this.applyMainAgent(sessionId)
      return { session_id: sessionId }
    })
  }

  /** 列表只展示已完成创建的项目，打开时继续使用其原会话。 */
  async listProjects() {
    const state = await this.#readBindings()
    const rows = Object.values(state.requests).filter(row => row.session_id && row.workspace && !row.deleted_at)
    return Promise.all(rows.map(async row => {
      const manager = await ProjectManager.open(join(this.root, 'projects', row.project_id, 'project.json'))
      const info = manager.read().basic_info
      return { id: row.project_id, name: info.name, aspect_ratio: info.aspect_ratio, session_id: row.session_id }
    }))
  }

  async snapshot(sessionId) {
    const state = await this.#readBindings()
    const id = Object.hasOwn(state.sessions, sessionId) ? state.sessions[sessionId] : null
    if (!id) return { project: null }
    const request = Object.values(state.requests).find(row => row.project_id === id)
    if (request?.deleted_at) return { project: null }
    const manager = await ProjectManager.open(join(this.root, 'projects', id, 'project.json'))
    return { project: manager.read(), session_id: request.session_id, workspace: request.workspace }
  }

  /** 编辑走同一串行队列，绑定与旧值在服务端核对，创建请求快照保持原样。 */
  edit(command, { sessionId, projectId }) {
    return this.writes.run(async () => {
      const state = await this.#readBindings()
      if (!/^p_[a-f0-9-]{36}$/i.test(projectId || '') || state.sessions[sessionId] !== projectId)
        throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      if (Object.values(state.requests).some(row => row.project_id === projectId && row.deleted_at))
        throw Object.assign(new Error('项目已删除'), { code: 'PROJECT_DELETED' })
      const manager = await ProjectManager.open(join(this.root, 'projects', projectId, 'project.json'))
      if (command.kind !== 'node_opinion' && this.activeExecution(projectId)) throw Object.assign(new Error('剧本任务正在执行，请结束后再修改资料或规则'), { code: 'PROJECT_ACTIVE' })
      const previous = manager.read(), next = editProject(previous, command)
      if (scriptFingerprint(previous) !== scriptFingerprint(next) && previous.script_revision.output.body) {
        next.script_revision.node_state = new NodeStateModel({ ...next.script_revision.node_state, status: 'expired', reason: '剧本资料或规则已变化，需重新优化' }).toJSON()
        expireScriptDependents(next)
      }
      if (JSON.stringify(next) === JSON.stringify(previous)) return { project: previous }
      const row = Object.values(state.requests).find(item => item.project_id === projectId)
      const renamed = next.basic_info.name !== previous.basic_info.name
      if (renamed) await this.workspaceController.rename({ workspaceId: row.workspace.id, title: next.basic_info.name })
      manager.change(draft => Object.assign(draft, next))
      try { await manager.model.update() }
      catch (error) {
        if (renamed) {
          try { await this.workspaceController.rename({ workspaceId: row.workspace.id, title: previous.basic_info.name }) }
          catch (rollback) { throw new AggregateError([error, rollback], '项目保存失败，工作区名称恢复失败') }
        }
        throw error
      }
      this.emit('updated', { project_id: projectId, session_ids: Object.keys(state.sessions).filter(id => state.sessions[id] === projectId) })
      return { project: manager.read() }
    })
  }

  /** 移除工作区登记后标记项目删除；目录、会话和记录保留。 */
  remove({ sessionId, projectId }) {
    return this.writes.run(async () => {
      const state = await this.#readBindings()
      if (!/^p_[a-f0-9-]{36}$/i.test(projectId || '') || !Object.hasOwn(state.sessions, sessionId) || state.sessions[sessionId] !== projectId)
        throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      const rows = Object.values(state.requests).filter(row => row.project_id === projectId)
      if (!rows.length) throw Object.assign(new Error('项目不存在'), { code: 'ENOENT' })
      if (!rows.every(row => row.deleted_at)) {
        const active = this.records?.tasks.activeGroups(this.records.scope) || []
        if (active.some(({ group, tasks }) => tasks.some(task => ['queued', 'running'].includes(task.task_status) && (task.metadata.project_id ?? group.metadata.project_id) === projectId)))
          throw Object.assign(new Error('项目有排队或执行中的任务，请结束后再删除'), { code: 'PROJECT_ACTIVE' })
      }
      // 只使用服务端绑定的ID；宿主已删而bindings未落盘时，重试仍可完成。
      for (const workspaceId of new Set(rows.map(row => row.workspace?.id).filter(Boolean))) {
        try { await this.workspaceController.delete({ workspaceId }) }
        catch (error) { if (error.code !== 'workspace/not-found') throw error }
      }
      if (!rows.every(row => row.deleted_at)) {
        const deletedAt = new Date().toISOString()
        for (const row of rows) row.deleted_at = deletedAt
        await this.#saveBindings(state)
      }
      this.emit('updated', { project_id: projectId, deleted: true, session_ids: Object.keys(state.sessions).filter(id => state.sessions[id] === projectId) })
      return { deleted: true, project_id: projectId }
    })
  }

  create(input, { sessionId, requestId }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof requestId !== 'string' || !requestId)
      return Promise.reject(new TypeError('需提供会话ID和请求ID'))
    const info = projectInfo(input)
    return this.writes.run(() => this.#creator.execute(info, { sessionId, requestId }))
  }

  /** 跨盒子的活动任务查询，用于项目写入保护和面板状态投影。 */
  activeExecution(projectId, nodeType) {
    if (!this.records) return null
    for (const { group, tasks } of this.records.tasks.activeGroups(this.records.scope)) {
      const task = tasks.find(task => (!nodeType || task.node_type === nodeType)
        && (task.metadata.project_id ?? group.metadata.project_id) === projectId
        && ['queued', 'running'].includes(task.task_status))
      if (task) return { group_id: group.id, status: task.task_status }
    }
    return null
  }
}
