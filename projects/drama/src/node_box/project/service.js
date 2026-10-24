import { shotFingerprint, expireShotDependents } from '../shot_design/state.js'
import { applyExecutionStates, projectExecutions, stateSummary } from '../../node_runtime/execution_state.js'
import { nodeState } from '../../node_runtime/node_state.js'
import { scriptOutput, originalFilename, scriptSummary } from '../../node_runtime/node_state.js'
import { saveProjectScript, readProjectScript } from './script_files.js'
import { editProject } from './edit_project.js'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { CreateProjectExecutor, ProjectExecutor } from './executor.js'
import { projectInfo } from './create_project.js'
import { NodeStateModel } from '@agent-modules/task/models'
import { createWriteQueue } from '../../project_runtime/write_queue.js'
import { digest, scriptFingerprint, expireScriptDependents } from '../script_revision/state.js'
import { sceneFingerprint, expireSceneDependents } from '../scene_extraction/state.js'
import { groupFingerprint, expireGroupDependents } from '../group_setting/state.js'
import { characterFingerprint, expireCharacterDependents } from '../character_extraction/state.js'
import { storyFingerprint, expireStoryDependents } from '../story_segments/state.js'
import { waitBoxTask } from '../../node_runtime/box_report.js'

/** 会话与面板共用项目服务：绑定、事件和创建/编辑/删除共享串行队列。 */
export class ProjectService extends EventEmitter {
  #creator
  #taskWatches = new Map()

  constructor({ root, workspaceController, sessionController, workspaceForSession }) {
    super()
    this.writes = createWriteQueue()
    this.root = root
    this.workspaceController = workspaceController
    this.sessionController = sessionController
    this.workspaceForSession = workspaceForSession
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

  /** 宿主刷新可恢复同工作区的另一会话；以真实成员及已完成项目登记解析，不按名称匹配。 */
  projectIdForSession(state, sessionId) {
    if (Object.hasOwn(state.sessions, sessionId)) return state.sessions[sessionId]
    const workspace = this.workspaceForSession?.(sessionId)
    if (!workspace) return null
    const row = Object.values(state.requests).find(row => row.session_id && !row.deleted_at
      && row.workspace?.id === workspace.id && row.workspace.path === workspace.path
      && workspace.path === join(this.root, 'projects', row.project_id))
    return row?.project_id || null
  }

  sessionInProject(sessionId, projectId) {
    return this.workspaceForSession?.(sessionId)?.path === join(this.root, 'projects', projectId)
  }

  async snapshot(sessionId) {
    const state = await this.#readBindings()
    const id = this.projectIdForSession(state, sessionId)
    if (!id) return { project: null }
    const request = Object.values(state.requests).find(row => row.project_id === id)
    if (request?.deleted_at) return { project: null }
    const manager = await ProjectManager.open(join(this.root, 'projects', id, 'project.json'))
    const active = this.activeExecution(id, 'project')
    const project = manager.read(), projected = applyExecutionStates(structuredClone(project), projectExecutions(this.records, id))
    if (this.recordsEnabled && JSON.stringify(project) !== JSON.stringify(projected))
      void this.syncExecutionStates().catch(error => this.emit('execution-state-error', error))
    return { project: projected, session_id: sessionId, workspace: request.workspace,
      original_summary_execution: active?.step?.kind === 'extract_summary' ? active : null }
  }

  async nodeStates(sessionId) {
    const { project } = await this.snapshot(sessionId)
    if (!project) return { project_id: null, nodes: {} }
    const types = ['project', 'script_revision', 'story_segments', 'group_setting', 'character_extraction', 'scene_extraction', 'shot_design', 'clip_arrangement', 'video_prompt']
    const nodes = Object.fromEntries(types.map(type => [type, { ...stateSummary(nodeState(project, type)), active_execution: (() => { const active = this.activeExecution(project.basic_info.id, type); if (!active) return null; const { node_state_before, ...summary } = active; return summary })() }]))
    const visit = (value, path) => {
      if (!value || typeof value !== 'object') return
      if (value.node_state) nodes[path] = { ...stateSummary(value.node_state), active_execution: null }
      for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules'].includes(key) && child && typeof child === 'object') visit(child, `${path}/${key}`)
    }
    for (const type of ['character_extraction', 'scene_extraction']) visit(project[type].assets, `/${type}/assets`)
    for (const type of ['videos', 'episodes']) visit(project[type], `/${type}`)
    const sceneImageActive = this.activeExecution(project.basic_info.id, 'scene_image')
    if (sceneImageActive) project.scene_extraction.assets.forEach((asset,index) => { const entry = nodes[`/scene_extraction/assets/${index}/image_generation`]; if (asset.scene_id === sceneImageActive.scene_id && entry) { const {node_state_before,...active} = sceneImageActive; entry.active_execution = active } })
    return { project_id: project.basic_info.id, nodes }
  }

  async readOriginalScript(sessionId) {
    const { project } = await this.snapshot(sessionId)
    if (!project?.basic_info.original_script_file_path) throw new Error('尚未导入原始剧本')
    return { body: await readProjectScript(this.root, project.basic_info.id, project.basic_info.original_script_file_path), originalName: originalFilename(project.basic_info) }
  }

  /** 编辑走同一串行队列，绑定与旧值在服务端核对，创建请求快照保持原样。 */
  edit(command, { sessionId, projectId, operationGroupId, requestId, source = 'api' }) {
    if (command?.kind === 'import_script' && this.summaryModels && this.recordsEnabled && !operationGroupId)
      return this.importScript(command, { sessionId, projectId, requestId, source })
    return this.writes.run(async () => {
      const state = await this.#readBindings()
      if (!/^p_[a-f0-9-]{36}$/i.test(projectId || '') || this.projectIdForSession(state, sessionId) !== projectId)
        throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      if (Object.values(state.requests).some(row => row.project_id === projectId && row.deleted_at))
        throw Object.assign(new Error('项目已删除'), { code: 'PROJECT_DELETED' })
      const manager = await ProjectManager.open(join(this.root, 'projects', projectId, 'project.json'))
      if (command.kind !== 'node_opinion' && this.activeExecution(projectId, undefined, operationGroupId)) throw Object.assign(new Error('项目任务正在执行，请结束后再修改资料或规则'), { code: 'PROJECT_ACTIVE' })
      const previous = manager.read(), next = editProject(previous, command)
      if (storyFingerprint(previous) !== storyFingerprint(next) && previous.story_segments.segments.length) {
        next.story_segments.node_state = new NodeStateModel({ ...next.story_segments.node_state, status: 'expired', reason: '大纲资料或规则已变化，需重新生成' }).toJSON()
        expireStoryDependents(next)
      }
      if (sceneFingerprint(previous) !== sceneFingerprint(next) && previous.scene_extraction.node_state.status !== 'empty') {
        next.scene_extraction.node_state = new NodeStateModel({ ...next.scene_extraction.node_state, status: 'expired', reason: '场景资料或规则已变化，需重新生成' }).toJSON()
        expireSceneDependents(next)
      }
      if (groupFingerprint(previous) !== groupFingerprint(next) && previous.group_setting.node_state.status !== 'empty') {
        next.group_setting.node_state = new NodeStateModel({ ...next.group_setting.node_state, status: 'expired', reason: '团队资料或规则已变化，需重新生成' }).toJSON()
        expireGroupDependents(next)
      }
      if (characterFingerprint(previous) !== characterFingerprint(next) && previous.character_extraction.characters.length) {
        next.character_extraction.node_state = new NodeStateModel({ ...next.character_extraction.node_state, status: 'expired', reason: '角色资料或规则已变化，需重新生成' }).toJSON()
        expireCharacterDependents(next)
      }
      if (shotFingerprint(previous) !== shotFingerprint(next) && previous.shot_design.shots.length) {
        next.shot_design.node_state = new NodeStateModel({...next.shot_design.node_state, status:'expired', reason:'分镜资料或规则已变化，需重新生成'}).toJSON()
        expireShotDependents(next)
      }
      if (command.kind !== 'import_script' && scriptFingerprint(previous) !== scriptFingerprint(next) && previous.basic_info.actual_script) {
        next.basic_info.script_revision_node = new NodeStateModel({ ...next.basic_info.script_revision_node, status: 'expired', reason: '剧本资料或规则已变化，需重新优化' }).toJSON()
        expireScriptDependents(next)
      }
      if (command.kind === 'import_script') {
        await saveProjectScript(this.root, projectId, { body: command.value, originalName: originalFilename(next.basic_info) })
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
      if (!/^p_[a-f0-9-]{36}$/i.test(projectId || '') || this.projectIdForSession(state, sessionId) !== projectId)
        throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      const rows = Object.values(state.requests).filter(row => row.project_id === projectId)
      if (!rows.length) throw Object.assign(new Error('项目不存在'), { code: 'ENOENT' })
      const relatedSessions = [...new Set([sessionId, ...(this.workspaceForSession?.(sessionId)?.sessionIds || []), ...Object.keys(state.sessions).filter(id => state.sessions[id] === projectId)])]
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
      const sessionRequestId = rows.find(row => row.deleted_session_request_id)?.deleted_session_request_id || randomUUID()
      const deletedAt = new Date().toISOString()
      for (const row of rows) { row.deleted_at ||= deletedAt; row.deleted_session_request_id = sessionRequestId }
      await this.#saveBindings(state)
      this.emit('updated', { project_id: projectId, deleted: true, session_ids: relatedSessions })
      return { deleted: true, project_id: projectId, session_request_id: sessionRequestId }
    }).then(async result => {
      // startSession自身使用同一写队列，必须在删除事务释放后接续。
      try { return { ...result, ...await this.startSession(result.session_request_id) } }
      catch (error) { return { ...result, session_error: `项目已删除，创建空会话失败：${error.message}` } }
    })
  }

  /** 根插件显式配置模型；纯存储组件不会隐式访问模型服务。 */
  configureOriginalSummary(models) { this.summaryModels = models }

  async importScript(command, { sessionId, projectId, requestId = randomUUID(), source }) {
    const id = digest(['project-import', sessionId, requestId])
    await this.writes.run(async () => {
      const snapshot = await this.snapshot(sessionId)
      if (!snapshot.project || snapshot.project.basic_info.id !== projectId) throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      const old = this.records.tasks.detail(this.records.scope, id)
      if (old) {
        if (JSON.stringify(old.tasks[0].metadata.command) !== JSON.stringify(command)) throw new Error('同一请求ID不能用于不同导入内容')
        return
      }
      if (this.activeExecution(projectId)) throw Object.assign(new Error('项目任务正在执行，请结束后再导入'), { code: 'PROJECT_ACTIVE' })
      editProject(snapshot.project, command)
      this.records.tasks.submit(this.records.scope, {
        group: { id, name: '导入原始剧本', source, metadata: { notify_main: source === 'ui' } },
        tasks: [{ node_type: 'project', action: 'import_script', name: '导入原始剧本', metadata: {
          project_id: projectId, session_id: sessionId, command: structuredClone(command), goal: '导入原始剧本并提取展示摘要',
        } }],
      })
    })
    if (source === 'ui') await this.showPanelTaskStart?.(id)
    this.watchProjectTask(id)
    this.records.tasks.start(this.records.scope)
    const report = await waitBoxTask(this.records, id)
    await this.writes.run(() => {})
    if (report.status !== 'completed') throw new Error(report.reason || '剧本导入失败')
    return { ...(await this.snapshot(sessionId)), group_id: id, report, ...(report.warning ? { warning: report.warning } : {}) }
  }

  /** 仅提供数据提交能力；步骤编排与模型调用由Executor负责。 */
  saveOriginalSummary({ sessionId, projectId, originalScript, output, expectedOutput, expectedScriptOutput, expectedSource, signal }) {
    return this.writes.run(async () => {
      signal.throwIfAborted()
      const snapshot = await this.snapshot(sessionId)
      if (!snapshot.project || snapshot.project.basic_info.id !== projectId) throw new Error('项目已删除或会话归属改变')
      const manager = await ProjectManager.open(join(this.root, 'projects', projectId, 'project.json'))
      if (manager.read().basic_info.original_script_file_path !== expectedSource || manager.read().basic_info.actual_script !== originalScript) throw new Error('原稿已变化，摘要未写入')
      if (digest(scriptSummary(manager.read())) !== digest(expectedOutput) || digest(scriptOutput(manager.read())) !== digest(expectedScriptOutput)) throw new Error('项目摘要或预估时长已变化，拒绝覆盖较新结果')
      signal.throwIfAborted()
      manager.change(project => {
        Object.assign(project.basic_info, structuredClone(output))
      })
      await manager.model.update()
      this.emit('updated', { project_id: projectId, session_ids: [sessionId] })
    })
  }

  enableTaskRecords(records) {
    if (this.recordsEnabled) return
    this.records = records
    this.executor = new ProjectExecutor({
      records,
      models: () => this.summaryModels,
      create: (info, context) => this.writes.run(() => this.#creator.execute(info, context)),
      edit: (command, context) => this.edit(command, context),
      snapshot: sessionId => this.snapshot(sessionId),
      saveSummary: input => this.saveOriginalSummary(input),
    })
    this.recordsEnabled = true
    const dispose = records.dispose.bind(records)
    records.dispose = async () => {
      await records.tasks.dispose()
      this.executionUnsubscribe?.()
      await this.writes.run(() => {})
      await dispose()
    }
    this.executionUnsubscribe = records.tasks.store.subscribe(scope => {
      if (scope !== records.scope) return
      // 只有Task终态集合变化才落盘，步骤/HTTP进度不重复扫描项目文件。
      const terminal = records.tasks.store.read(scope, { steps: false }).tasks.filter(task => !['queued', 'running'].includes(task.task_status))
      const signature = JSON.stringify(terminal.map(task => [task.id, task.task_status, task.ended_at]))
      if (signature === this.executionSignature) return
      this.executionSignature = signature
      void this.syncExecutionStates().catch(error => this.emit('execution-state-error', error))
    })
  }

  syncExecutionStates() {
    const records = this.records
    return this.writes.run(async () => {
      const bindings = await this.#readBindings()
      const ids = new Set(Object.values(bindings.requests).filter(row => !row.deleted_at).map(row => row.project_id))
      for (const id of ids) {
        let manager
        try { manager = await ProjectManager.open(join(this.root, 'projects', id, 'project.json')) }
        catch (error) { if (error.code === 'INVALID_PROJECT') continue; throw error }
        const previous = manager.read()
        const next = applyExecutionStates(structuredClone(previous), projectExecutions(records, id))
        if (JSON.stringify(previous) === JSON.stringify(next)) continue
        manager.change(project => Object.assign(project, next))
        await manager.model.update()
        this.emit('updated', { project_id: id, session_ids: Object.keys(bindings.sessions).filter(session => bindings.sessions[session] === id) })
      }
    })
  }


  /** 摘要步骤与Task终态都推送，避免失败/取消后面板一直loading。 */
  watchProjectTask(id) {
    if (this.#taskWatches.has(id)) return
    let last = ''
    const notify = () => {
      const detail = this.records.tasks.detail(this.records.scope, id)
      const task = detail?.tasks[0]
      if (!task) return
      const signature = JSON.stringify([detail.tasks.map(row => row.task_status), detail.steps.map(step => [step.id, step.step_status])])
      if (signature !== last) {
        last = signature
        const m = task.metadata
        if (task.action !== 'create' || detail.steps.some(step => step.result?.created))
          this.emit('updated', { project_id: m.project_id, session_ids: [m.session_id, m.target_session_id, m.source_session_id].filter(Boolean) })
      }
      if (!detail.tasks.some(row => ['queued', 'running'].includes(row.task_status))) { unsubscribe(); this.#taskWatches.delete(id) }
    }
    const unsubscribe = this.records.tasks.store.subscribe(scope => { if (scope === this.records.scope) notify() })
    this.#taskWatches.set(id, unsubscribe)
    notify()
  }

  /** 面板只等待创建里程碑，不等待同一Task里的摘要；不提前标记Task完成。 */
  waitProjectCreated(id) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const detail = this.records.tasks.detail(this.records.scope, id)
        const created = detail?.steps.find(step => step.kind === 'create' && step.step_status === 'done')?.result?.created
        if (created) { unsubscribe(); resolve({ ...created, group_id: id, status: detail.status }); return }
        if (!detail || !['queued', 'running'].includes(detail.status)) {
          unsubscribe(); reject(new Error(detail?.reason || '创建项目失败'))
        }
      }
      const unsubscribe = this.records.tasks.store.subscribe(scope => { if (scope === this.records.scope) check() })
      check()
    })
  }

  create(input, { sessionId, requestId, source = 'api', goal = '创建项目' }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof requestId !== 'string' || !requestId)
      return Promise.reject(new TypeError('需提供会话ID和请求ID'))
    const info = projectInfo(input)
    if (!this.recordsEnabled) return this.writes.run(() => this.#creator.execute(info, { sessionId, requestId }))
    const prepared = this.writes.run(async () => {
      const state = await this.#readBindings(), key = JSON.stringify([sessionId, requestId])
      let row = state.requests[key]
      if (row?.deleted_at) throw Object.assign(new Error('项目已删除，请使用新的创建请求'), { code: 'PROJECT_DELETED' })
      if (row && JSON.stringify(row.info) !== JSON.stringify(info)) throw new Error('同一请求ID不能用于不同项目资料')
      if (!row) row = state.requests[key] = { project_id: `p_${randomUUID()}`, info }
      row.pending_session_id ??= row.session_id || `session-${randomUUID()}`
      await this.#saveBindings(state)
      let attempt = 0, id, old
      do {
        id = digest(['project', sessionId, requestId, attempt++])
        old = this.records.tasks.detail(this.records.scope, id)
        if (old && ['queued', 'running', 'completed'].includes(old.status)) return id
      } while (old)
      this.records.tasks.submit(this.records.scope, {
        group: { id, name: '创建项目', source, metadata: { notify_main: true } },
        tasks: [{ node_type: 'project', action: 'create', name: '创建项目', metadata: {
          project_id: row.project_id, source_session_id: sessionId, target_session_id: row.pending_session_id,
          request_id: requestId, info, goal, attempt,
        } }],
      })
      return id
    })
    return prepared.then(async id => {
      if (source === 'ui') await this.showPanelTaskStart?.(id)
      this.watchProjectTask(id)
      this.records.tasks.start(this.records.scope)
      if (source === 'ui') return this.waitProjectCreated(id)
      const report = await waitBoxTask(this.records, id)
    await this.writes.run(() => {})
      if (report.status !== 'completed') throw new Error(report.reason || '创建项目失败')
      return { ...report.result, group_id: id, report, ...(report.warning ? { warning: report.warning } : {}) }
    })
  }

  async editUpstream(command, { sessionId, requestId, reportId, signal }) {
    const previous = this.records.tasks.detail(this.records.scope, reportId)
    if (!previous || previous.tasks[0].metadata.session_id !== sessionId || previous.status !== 'rejected'
      || previous.steps.findLast(step => step.result?.review)?.result.review.status !== 'upstream_issue')
      throw Object.assign(new Error('需提供当前会话的上游问题报告'), { code: 'PROJECT_SCOPE' })
    if (!['basic_info', 'import_script'].includes(command?.kind)) throw new TypeError('只允许修复项目基本资料或导入用户提供的原稿')
    const projectId = previous.tasks[0].metadata.project_id
    const id = digest(['project-edit', sessionId, requestId])
    await this.writes.run(async () => {
      if (!this.records.tasks.detail(this.records.scope, id)) this.records.tasks.submit(this.records.scope, {
        group: { id, name: '修复项目上游资料', source: 'conversation', metadata: { parent_group_id: reportId } },
        tasks: [{ node_type: 'project', action: 'edit', name: '修复项目资料', metadata: {
          project_id: projectId, session_id: sessionId, parent_group_id: reportId,
          command, goal: previous.tasks[0].metadata.goal || previous.tasks[0].metadata.instruction,
        } }],
      })
    })
    this.watchProjectTask(id)
    this.records.tasks.start(this.records.scope)
    return waitBoxTask(this.records, id, signal)
  }

  /** 跨盒子的活动任务查询，用于项目写入保护和面板状态投影。 */
  activeExecution(projectId, nodeType, excludeGroupId) {
    if (!this.records) return null
    for (const { group, tasks } of this.records.tasks.activeGroups(this.records.scope)) {
      if (group.id === excludeGroupId) continue
      const task = tasks.find(task => (!nodeType || task.node_type === nodeType)
        && (task.metadata.project_id ?? group.metadata.project_id) === projectId
        && ['queued', 'running'].includes(task.task_status))
      if (task) {
        const detail = this.records.tasks.detail(this.records.scope, group.id)
        const steps = detail.steps.filter(step => step.task_id === task.id).sort((a, b) => a.seq - b.seq)
        const current = steps.find(step => step.step_status === 'running') || steps.find(step => step.step_status === 'ready')
        const review = steps.findLast(step => step.step_status === 'done' && step.result?.review)
        return { group_id: group.id, task_id: task.id, status: task.task_status, ...(task.node_type === 'scene_image' ? {scene_id:task.metadata.scene_id} : {}),
          step: current ? { id: current.id, kind: current.kind, name: current.name, status: current.step_status } : null,
          review_issues: review?.result.review.issues || [],
          node_state_before: task.metadata.node_state_before || null,
        }
      }
    }
    return null
  }
}
