import { editProject } from '../project/edit_project.js'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectManager } from '../project/project_manager.js'
import { ProjectModel } from '../project/project_model.js'
import { createProject, projectFields, projectInfo } from '../project/create_project.js'

/** 会话与面板共用的创建入口；先落盘，再登记工作区/会话，最后发布成功事件。 */
export class CreateProjectTool extends EventEmitter {
  #tail = Promise.resolve()

  constructor({ root, workspaceController, sessionController }) {
    super()
    this.root = root
    this.workspaceController = workspaceController
    this.sessionController = sessionController
    this.name = 'drama-create-project'
    this.description = '按用户明确请求创建短剧项目，保存本地JSON，为项目创建以项目名称命名的独立工作区和新会话，保留原会话归属及消息。只需项目名；未提供的剧本和创作要求留空，不编造。返回新会话ID，面板自动切换。允许从已有项目会话创建其他项目。'
    this.parameters = { type: 'object', additionalProperties: false, properties: projectFields, required: ['name'] }
    this.output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
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
    const run = this.#tail.catch(() => {}).then(async () => {
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
    this.#tail = run
    return run
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
    const run = this.#tail.catch(() => {}).then(async () => {
      const state = await this.#readBindings()
      if (!/^p_[a-f0-9-]{36}$/i.test(projectId || '') || state.sessions[sessionId] !== projectId)
        throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      if (Object.values(state.requests).some(row => row.project_id === projectId && row.deleted_at))
        throw Object.assign(new Error('项目已删除'), { code: 'PROJECT_DELETED' })
      const manager = await ProjectManager.open(join(this.root, 'projects', projectId, 'project.json'))
      const previous = manager.read(), next = editProject(previous, command)
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
    this.#tail = run
    return run
  }

  /** 移除工作区登记后标记项目删除；目录、会话和记录保留。 */
  remove({ sessionId, projectId }) {
    const run = this.#tail.catch(() => {}).then(async () => {
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
    this.#tail = run
    return run
  }

  async execute(args, exec) {
    const sessionId = exec?.agent?.session?.id
    if (!sessionId) throw new Error('必须从 Harness 会话调用')
    return JSON.stringify(await this.create(args, { sessionId, requestId: exec.callId }))
  }

  create(input, { sessionId, requestId }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof requestId !== 'string' || !requestId)
      return Promise.reject(new TypeError('需提供会话ID和请求ID'))
    const info = projectInfo(input)
    const run = this.#tail.catch(() => {}).then(() => this.#create(info, sessionId, requestId))
    this.#tail = run
    return run
  }

  async #create(info, sourceSessionId, requestId) {
    const state = await this.#readBindings()
    const key = JSON.stringify([sourceSessionId, requestId])
    let row = state.requests[key]
    if (row?.deleted_at) throw Object.assign(new Error('项目已删除，请使用新的创建请求'), { code: 'PROJECT_DELETED' })
    if (row && JSON.stringify(row.info) !== JSON.stringify(info)) throw new Error('同一请求ID不能用于不同项目资料')
    if (!row) {
      row = state.requests[key] = { project_id: `p_${randomUUID()}`, info }
      await this.#saveBindings(state)
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
      await this.#saveBindings(state)
    }
    await this.workspaceController.rename({ workspaceId: row.workspace.id, title: manager.read().basic_info.name })
    if (!row.session_id) {
      row.pending_session_id ??= `session-${randomUUID()}`
      await this.#saveBindings(state)
      row.session_id = (await this.sessionController.create({ sessionId: row.pending_session_id, workspaceId: row.workspace.id, agentPreset: 'standard' })).sessionId
      state.sessions[row.session_id] = row.project_id
      await this.#saveBindings(state)
    }
    if (this.applyMainAgent) await this.applyMainAgent(row.session_id)
    const result = { project_id: row.project_id, session_id: row.session_id, workspace: row.workspace }
    this.emit('created', { source_session_id: sourceSessionId, ...result })
    return result
  }
}
