import { boxReport, waitBoxTask } from '../../node_runtime/box_report.js'
import { RuleChangeExecutor } from './rule_change_executor.js'
import { join } from 'node:path'
import { NodeStateModel } from '@agent-modules/task/models'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { ScriptRevisionExecutor } from './executor.js'
import { digest, scriptFingerprint, expireScriptDependents } from './state.js'

/** 面板和主Agent Tool共用的剧本优化入口；与项目管理共用一个写入队列。 */
export class ScriptRevisionService {
  constructor({ projects, records, models }) {
    projects.enableTaskRecords(records)
    this.projects = projects
    this.root = projects.root
    this.records = records
    this.scriptModels = models
    this.ruleChanger = new RuleChangeExecutor({ projects, records })
    this.executor = new ScriptRevisionExecutor({
      projects: {
        snapshot: sessionId => projects.snapshot(sessionId),
        saveScriptCandidate: (...args) => this.saveScriptCandidate(...args),
      },
      records, models,
    })
  }

  scriptExecution(projectId) {
    return this.projects.activeExecution(projectId, 'script_revision')
  }

  optimizeScript({ instruction, retry_of }, { sessionId, projectId, requestId, source = 'api' }) {
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 10000) throw new TypeError('请提供1—10000字的剧本优化要求')
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw new TypeError('缺少有效优化请求ID')
    const run = this.projects.writes.run(async () => {
      const snapshot = await this.projects.snapshot(sessionId), project = snapshot.project
      if (!project || (projectId && project.basic_info.id !== projectId)) throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      projectId = project.basic_info.id
      const parent = retry_of ? this.records.tasks.detail(this.records.scope, retry_of) : null
      if (retry_of && (!parent || parent.tasks[0].node_type !== 'script_revision' || parent.tasks[0].metadata.session_id !== sessionId
        || parent.tasks[0].metadata.project_id !== projectId || ['queued', 'running'].includes(parent.status)))
        throw Object.assign(new Error('原任务不属于当前会话或尚未结束'), { code: 'PROJECT_SCOPE' })
      if (parent && parent.tasks[0].metadata.input_hash === scriptFingerprint(project)
        && !(parent.status === 'completed' && instruction.trim() !== parent.tasks[0].metadata.instruction))
        throw new Error('上游资料或规则尚未变化，请先修复后再派发新任务')
      const id = digest(['script_revision', sessionId, requestId])
      const old = this.records.tasks.detail(this.records.scope, id)
      if (old) {
        if (old.tasks[0].metadata.instruction !== instruction.trim() || (old.tasks[0].metadata.parent_group_id || undefined) !== retry_of) throw new Error('同一请求ID不能用于不同优化要求')
        return { project_id: projectId, group_id: id, status: old.status }
      }
      if (!project.basic_info.original_script.trim()) throw new Error('请先导入原始剧本，再执行优化')
      if (this.scriptExecution(projectId)) throw Object.assign(new Error('该项目已有排队或执行中的剧本任务'), { code: 'PROJECT_ACTIVE' })
      const config = await this.scriptModels.read()
      const metadata = { project_id: projectId, session_id: sessionId, instruction: instruction.trim(), request_id: requestId,
        input_hash: scriptFingerprint(project), output_hash: digest(project.script_revision.output), language: config.output_language,
        parent_group_id: retry_of || null, goal: parent?.tasks[0].metadata.goal || instruction.trim(),
        input_snapshot: { original_script: project.basic_info.original_script, creative_requirements: project.basic_info.creative_requirements,
          reference_episode_duration_seconds: project.basic_info.reference_episode_duration_seconds, rules: project.script_revision.rules },
      }
      this.records.tasks.submit(this.records.scope, { group: { id, name: '按要求优化剧本', source, metadata: { project_id: projectId, notify_main: source === 'ui', parent_group_id: retry_of || null } },
        tasks: [{ node_type: 'script_revision', name: '剧本优化', action: project.script_revision.output.body ? 'revise' : 'generate', metadata }],
      })
      let last = ''
      const notify = () => {
        const detail = this.records.tasks.detail(this.records.scope, id)
        const status = JSON.stringify([detail.status, detail.steps.map(step => [step.id, step.step_status])])
        if (status !== last) { last = status; this.projects.emit('updated', { project_id: projectId, session_ids: [sessionId] }) }
        if (!['queued', 'running'].includes(detail.status)) unsubscribe()
      }
      const unsubscribe = this.records.tasks.store.subscribe(scope => { if (scope === this.records.scope) notify() })
      notify()
      return { project_id: projectId, group_id: id, status: 'queued' }
    })
    return run.then(async result => { if (source === 'ui') await this.projects.showPanelTaskStart?.(result.group_id); this.records.tasks.start(this.records.scope); return result })
  }

  async waitScriptOptimization(groupId, sessionId, signal) {
    const detail = this.records.tasks.detail(this.records.scope, groupId)
    if (!detail || detail.tasks[0].metadata.session_id !== sessionId) throw Object.assign(new Error('任务不属于当前会话'), { code: 'PROJECT_SCOPE' })
    return waitBoxTask(this.records, groupId, signal)
  }

  async changeRules(patch, { sessionId, requestId, reportId, approval, signal }) {
    if (approval !== 'allowed-once') throw new Error('修改规则尚未获得用户授权')
    const previous = this.records.tasks.detail(this.records.scope, reportId)
    if (!previous || previous.tasks[0].metadata.session_id !== sessionId || boxReport(previous).decision !== 'rule_conflict')
      throw Object.assign(new Error('需提供当前会话的规则冲突报告'), { code: 'PROJECT_SCOPE' })
    const id = digest(['script-rules', sessionId, requestId])
    await this.projects.writes.run(async () => {
      if (!this.records.tasks.detail(this.records.scope, id)) this.records.tasks.submit(this.records.scope, {
        group: { id, name: '修改剧本规则', source: 'conversation', metadata: { parent_group_id: reportId } },
        tasks: [{ node_type: 'script_rules', action: 'change_rules', name: '修改剧本规则', metadata: {
          project_id: previous.tasks[0].metadata.project_id, session_id: sessionId,
          patch, approval, parent_group_id: reportId, goal: previous.tasks[0].metadata.goal,
        } }],
      })
    })
    this.records.tasks.start(this.records.scope)
    return waitBoxTask(this.records, id, signal)
  }


  saveScriptCandidate(ctx, output, { expectedOutput, passed = false, reason = '' }) {
    const run = this.projects.writes.run(async () => {
      ctx.signal.throwIfAborted()
      const { project_id: id, session_id: sessionId, input_hash: inputHash } = ctx.task.metadata
      const project = (await this.projects.snapshot(sessionId)).project
      if (!project || project.basic_info.id !== id || scriptFingerprint(project) !== inputHash || digest(project.script_revision.output) !== expectedOutput) throw new Error('项目内容已变化，拒绝覆盖优化结果')
      const detail = this.records.tasks.detail(this.records.scope, ctx.task.group_id)
      if (detail.tasks.find(task => task.id === ctx.task.id)?.task_status !== 'running') throw new Error('任务已结束，拒绝写入')
      const manager = await ProjectManager.open(join(this.root, 'projects', id, 'project.json'))
      manager.change(next => {
        if (digest(next.script_revision.output) !== digest(output)) expireScriptDependents(next)
        next.script_revision.output = output
        next.script_revision.node_state = new NodeStateModel({ status: passed ? 'generated' : 'rejected', reason: passed ? '' : reason, dependency_hash: inputHash }).toJSON()
      })
      ctx.signal.throwIfAborted()
      await manager.model.update()
      this.projects.emit('updated', { project_id: id, session_ids: [sessionId] })
    })
    return run
  }

}
