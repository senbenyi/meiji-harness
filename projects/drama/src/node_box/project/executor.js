import { extractOriginalSummary } from './summary_extractor.js'
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


/** 项目盒子任务执行器：一次受理一个Task，步骤定义及记录上下文都在执行层。 */
export class ProjectExecutor {
  constructor({ records, models, create, edit, snapshot, saveSummary }) {
    Object.assign(this, { records, models, create, edit, snapshot, saveSummary })
    records.tasks.register('project', {
      label: '项目管理',
      plan: task => this.plan(task),
      execute: ctx => this.execute(ctx),
    })
  }

  plan(task) {
    return [{ kind: task.action, name: task.action === 'create' ? '创建项目与工作区'
      : task.action === 'import_script' ? '保存原始剧本' : '修改项目上游资料', executor: 'program' }]
  }

  async execute(ctx) {
    const m = ctx.task.metadata
    ctx.signal.throwIfAborted()
    if (ctx.step.kind === 'extract_summary') return this.summarizeOriginal(ctx)
    const originalScript = m.info?.original_script ?? (m.command?.kind === 'import_script' ? m.command.value : '')
    const nextSteps = this.models() && originalScript.trim()
      ? [{ kind: 'extract_summary', name: '提取原始剧本摘要', executor: 'ai' }] : []
    if (ctx.task.action === 'create') {
      const created = await this.create(m.info, { sessionId: m.source_session_id, requestId: m.request_id })
      return { result: { created }, nextSteps }
    }
    await this.edit(m.command, { sessionId: m.session_id, projectId: m.project_id, operationGroupId: ctx.task.group_id })
    return { result: { changed: true, parent_group_id: m.parent_group_id ?? null }, nextSteps }
  }

  async summarizeOriginal(ctx) {
    const m = ctx.task.metadata
    const sessionId = m.target_session_id || m.session_id
    const originalScript = m.info?.original_script ?? m.command.value
    try {
      const current = (await this.snapshot(sessionId)).project
      if (!current || current.basic_info.id !== m.project_id || current.basic_info.original_script !== originalScript) throw new Error('原稿已变化，摘要未写入')
      const summary = await extractOriginalSummary(ctx, { originalScript, models: this.models(), records: this.records })
      await this.saveSummary({ sessionId, projectId: m.project_id, originalScript, summary, signal: ctx.signal })
      return { result: { original_script_summary: summary, changed: true, reference: '#/basic_info/original_script_summary' } }
    } catch (error) {
      ctx.signal.throwIfAborted()
      // 展示摘要失败只返回警告，不撤回已保存的项目或原稿。
      return { result: { summary_error: `原稿已保存，摘要未生成：${error.message}` } }
    }
  }
}
