import { scriptOutput, nodeRules } from '../../node_runtime/node_state.js'
import { boxReport, waitBoxTask } from '../../node_runtime/box_report.js'
import { RuleChangeExecutor } from './rule_change_executor.js'
import { join } from 'node:path'
import { NodeStateModel } from '@agent-modules/task/models'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { ScriptRevisionExecutor } from './executor.js'
import { digest, scriptFingerprint, expireScriptDependents } from './state.js'

/** 面板和主Agent Tool共用的剧本优化入口；与项目管理共用一个写入队列。 */
export class ScriptRevisionService {
  // 审核触发的自动修订上限，不包含首次生成或按意见修改。
  maxRevisionRounds = 3

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
      records, models, getMaxRevisionRounds: () => this.maxRevisionRounds,
    })
  }

  scriptExecution(projectId) {
    return this.projects.activeExecution(projectId, 'script_revision')
  }

  /** 盒子外部资料：current_script/instruction/output_language必选；当前工作稿是唯一剧本正文。
   * 规则、审核问题和修订轮次属于内部资料，不接受为业务输入。 */
  executionInput({ current_script, instruction, output_language, ...unknown } = {}) {
    if (Object.keys(unknown).length) throw new TypeError('剧本优化输入含未声明字段')
    if (!current_script || typeof current_script !== 'object' || Array.isArray(current_script)) throw new TypeError('current_script必选，需为普通对象')
    if (Object.keys(current_script).some(key => !['actual_script','summary','estimated_duration_seconds'].includes(key)) || typeof current_script.actual_script !== 'string' || !current_script.actual_script.trim() || typeof current_script.summary !== 'string' || !Number.isFinite(current_script.estimated_duration_seconds) || current_script.estimated_duration_seconds < 0) throw new TypeError('current_script需包含完整工作正文、摘要和非负估时')
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 10000) throw new TypeError('instruction必选，需为1—10000字的剧本优化要求')
    if (typeof output_language !== 'string' || !output_language.trim()) throw new TypeError('output_language必选，需为非空输出语言')
    return { current_script: structuredClone(current_script), instruction: instruction.trim(), output_language }
  }

  /** 调用参数instruction必选，retry_of可选；上下文sessionId/requestId必选，projectId/source可选。
   * 原稿、已有稿、语言由Service从绑定项目和设置解析，再交executionInput验证。 */
  optimizeScript({ instruction, retry_of, ...unknown } = {}, { sessionId, projectId, requestId, source = 'api' } = {}) {
    if (Object.keys(unknown).length) throw new TypeError('只允许提交instruction和retry_of')
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 10000) throw new TypeError('请提供1—10000字的剧本优化要求')
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new TypeError('sessionId必选，需提供有效会话ID')
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw new TypeError('缺少有效优化请求ID')
    if (retry_of !== undefined && (typeof retry_of !== 'string' || !retry_of.trim())) throw new TypeError('retry_of可选，提供时需为非空任务报告ID')
    if (projectId !== undefined && (typeof projectId !== 'string' || !projectId.trim())) throw new TypeError('projectId可选，提供时需为非空项目ID')
    if (typeof source !== 'string' || !source.trim()) throw new TypeError('source需为非空来源标识')
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
      if (!project.basic_info.actual_script.trim()) throw new Error('请先导入原始剧本，再执行优化')
      if (this.projects.activeExecution(projectId)) throw Object.assign(new Error('该项目已有排队或执行中的剧本任务'), { code: 'PROJECT_ACTIVE' })
      const config = await this.scriptModels.read()
      const input = this.executionInput({ current_script: scriptOutput(project),
        instruction, output_language: config.output_language })
      const metadata = { project_id: projectId, session_id: sessionId, instruction: instruction.trim(), request_id: requestId,
        node_state_before: structuredClone(project.basic_info.script_revision_node),
        input_hash: scriptFingerprint(project), output_hash: digest(scriptOutput(project)), language: config.output_language,
        parent_group_id: retry_of || null, goal: parent?.tasks[0].metadata.goal || instruction.trim(),
        input_snapshot: { ...input, rules: nodeRules(project.basic_info.script_revision_node) },
      }
      this.records.tasks.submit(this.records.scope, { group: { id, name: '按要求优化剧本', source, metadata: { project_id: projectId, notify_main: source === 'ui', parent_group_id: retry_of || null } },
        tasks: [{ node_type: 'script_revision', name: '剧本优化', action: project.basic_info.script_revision_node.status === 'empty' ? 'generate' : 'revise', metadata }],
      })
      this.projects.watchProjectTask(id)
      return { project_id: projectId, group_id: id, status: 'queued' }
    })
    return run.then(async result => { if (source === 'ui') await this.projects.showPanelTaskStart?.(result.group_id); this.records.tasks.start(this.records.scope); return result })
  }

  async waitScriptOptimization(groupId, sessionId, signal) {
    const detail = this.records.tasks.detail(this.records.scope, groupId)
    if (!detail || detail.tasks[0].metadata.session_id !== sessionId) throw Object.assign(new Error('任务不属于当前会话'), { code: 'PROJECT_SCOPE' })
    const report = await waitBoxTask(this.records, groupId, signal)
    await this.projects.writes.run(() => {})
    return report
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
    if (!passed) return Promise.resolve()
    const run = this.projects.writes.run(async () => {
      ctx.signal.throwIfAborted()
      const { project_id: id, session_id: sessionId, input_hash: inputHash } = ctx.task.metadata
      const project = (await this.projects.snapshot(sessionId)).project
      if (!project || project.basic_info.id !== id || scriptFingerprint(project) !== inputHash || digest(scriptOutput(project)) !== expectedOutput) throw new Error('项目内容已变化，拒绝覆盖优化结果')
      const detail = this.records.tasks.detail(this.records.scope, ctx.task.group_id)
      if (detail.tasks.find(task => task.id === ctx.task.id)?.task_status !== 'running') throw new Error('任务已结束，拒绝写入')
      const manager = await ProjectManager.open(join(this.root, 'projects', id, 'project.json'))
      manager.change(next => {
        if (digest(scriptOutput(next)) !== digest(output)) expireScriptDependents(next)
        Object.assign(next.basic_info, structuredClone(output))
        if (passed && next.basic_info.script_revision_node.opinion?.trim() === ctx.task.metadata.instruction) next.basic_info.script_revision_node.opinion = ''
        next.basic_info.script_revision_node = new NodeStateModel({ ...next.basic_info.script_revision_node, status: 'generated', reason: '', dependency_hash: inputHash }).toJSON()
      })
      ctx.signal.throwIfAborted()
      await manager.model.update()
      this.projects.emit('updated', { project_id: id, session_ids: [sessionId] })
    })
    return run
  }

}
