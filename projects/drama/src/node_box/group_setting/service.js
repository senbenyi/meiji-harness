import { join } from 'node:path'
import { NodeStateModel } from '@agent-modules/task/models'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { nodeRules } from '../../node_runtime/node_state.js'
import { boxReport, waitBoxTask, userRetry } from '../../node_runtime/box_report.js'
import { GroupSettingExecutor } from './executor.js'
import { GroupRulesExecutor } from './rule_change_executor.js'
import { digest, groupFingerprint, groupOutput, validateGroupCandidate, expireGroupDependents } from './state.js'

/** 面板与会话共用入口；每轮有效结果同步项目与步骤记录，审核结论不控制结果保存。 */
export class GroupSettingService {
  maxRevisionRounds = 3

  constructor({ projects, records, models }) {
    projects.enableTaskRecords(records)
    Object.assign(this, { projects, records, models })
    this.ruleChanger = new GroupRulesExecutor({ projects, records })
    this.executor = new GroupSettingExecutor({ projects: {
      snapshot: id => projects.snapshot(id), saveGroupCandidate: (...args) => this.saveGroupCandidate(...args),
    }, records, models, getMaxRevisionRounds: () => this.maxRevisionRounds })
  }

  executionInput({ story_outline, scene_extraction = { scenes: [] }, current_groups, instruction, output_language, ...unknown } = {}) {
    if (Object.keys(unknown).length) throw new TypeError('团队输入含未声明字段')
    if (!story_outline || !Array.isArray(story_outline.segments) || !story_outline.segments.length) throw new TypeError('请先生成故事大纲')
    if (!current_groups || Object.keys(current_groups).some(key => key !== 'groups') || !Array.isArray(current_groups.groups)) throw new TypeError('current_groups需为完整团队集合')
    if (!scene_extraction || !Array.isArray(scene_extraction.scenes) || Object.keys(scene_extraction).some(key => key !== 'scenes')) throw new TypeError('scene_extraction需为场景资料')
    validateGroupCandidate(current_groups)
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 10000) throw new TypeError('instruction必选，需为1—10000字的团队要求')
    if (typeof output_language !== 'string' || !output_language.trim()) throw new TypeError('output_language必选')
    return structuredClone({ story_outline, scene_extraction, current_groups, instruction: instruction.trim(), output_language })
  }

  generateGroups({ instruction, retry_of, ...unknown } = {}, { sessionId, projectId, requestId, source = 'api', retryAction } = {}) {
    if (Object.keys(unknown).length) throw new TypeError('只允许提交instruction和retry_of')
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 10000) throw new TypeError('请提供1—10000字的团队要求')
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new TypeError('sessionId必选')
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new TypeError('缺少有效团队请求ID')
    for (const [key, value] of Object.entries({ retry_of, projectId })) if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new TypeError(`${key}需为非空标识`)
    if (typeof source !== 'string' || !source.trim()) throw new TypeError('source需为非空来源标识')
    const run = this.projects.writes.run(async () => {
      const { project } = await this.projects.snapshot(sessionId)
      if (!project || (projectId && project.basic_info.id !== projectId)) throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      projectId = project.basic_info.id
      const parent = retry_of ? this.records.tasks.detail(this.records.scope, retry_of) : null
      if (retryAction && parent) instruction = parent.tasks[0].metadata.instruction
      const id = digest(['group_setting', sessionId, requestId]), old = this.records.tasks.detail(this.records.scope, id)
      if (old) {
        if (old.tasks[0].metadata.instruction !== instruction.trim() || (old.tasks[0].metadata.parent_group_id || undefined) !== retry_of || (old.tasks[0].metadata.retry_action || undefined) !== retryAction) throw new Error('同一请求ID不能用于不同团队要求')
        return { project_id: projectId, group_id: id, status: old.status }
      }
      if (retry_of && (!parent || parent.tasks[0].node_type !== 'group_setting' || parent.tasks[0].metadata.session_id !== sessionId
        || parent.tasks[0].metadata.project_id !== projectId || ['queued', 'running'].includes(parent.status)))
        throw Object.assign(new Error('原任务不属于当前会话或尚未结束'), { code: 'PROJECT_SCOPE' })
      const retry = userRetry(parent, { source, action: retryAction })
      if (retryAction === 'continue' && parent.tasks[0].metadata.input_hash !== groupFingerprint(project)) throw new Error('原任务的资料或规则已变化，请选择重新生成')
      if (!retry && parent && parent.tasks[0].metadata.input_hash === groupFingerprint(project)
        && !(parent.status === 'completed' && instruction.trim() !== parent.tasks[0].metadata.instruction)) throw new Error('上游资料或规则尚未变化，请先修复后再派发新任务')
      if (!project.story_segments.segments.length) throw new Error('请先生成故事大纲，再提取团队')
      if (this.projects.activeExecution(projectId)) throw Object.assign(new Error('该项目已有排队或执行中的任务'), { code: 'PROJECT_ACTIVE' })
      const config = await this.models.read()
      const input = this.executionInput({ story_outline: { segments: structuredClone(project.story_segments.segments) }, scene_extraction: { scenes: structuredClone(project.scene_extraction?.scenes || []) }, current_groups: groupOutput(project), instruction, output_language: config.output_language })
      if (retryAction === 'continue') input.current_groups = retry.candidate
      const metadata = { project_id: projectId, project_name: project.basic_info.name, session_id: sessionId, request_id: requestId,
        instruction: input.instruction, language: input.output_language, goal: parent?.tasks[0].metadata.goal || input.instruction,
        retry_action: retryAction || null, retry_review_issues: retryAction === 'continue' ? retry.issues : null,
        parent_group_id: retry_of || null, node_state_before: structuredClone(project.group_setting.node_state),
        input_hash: groupFingerprint(project), output_hash: digest(groupOutput(project)), input_snapshot: { ...input, rules: nodeRules(project.group_setting.node_state) } }
      this.records.tasks.submit(this.records.scope, { group: { id, name: '生成团队', source, metadata: { project_id: projectId, notify_main: source === 'ui', parent_group_id: retry_of || null } },
        tasks: [{ node_type: 'group_setting', name: '团队', action: retryAction ? retryAction === 'continue' ? 'revise' : 'generate' : project.group_setting.groups.length ? 'revise' : 'generate', metadata }] })
      this.projects.watchProjectTask(id)
      return { project_id: projectId, group_id: id, status: 'queued' }
    })
    return run.then(async result => { if (source === 'ui') await this.projects.showPanelTaskStart?.(result.group_id); this.records.tasks.start(this.records.scope); return result })
  }

  async waitGroups(groupId, sessionId, signal) {
    const detail = this.records.tasks.detail(this.records.scope, groupId)
    if (!detail || detail.tasks[0].node_type !== 'group_setting' || detail.tasks[0].metadata.session_id !== sessionId) throw Object.assign(new Error('任务不属于当前会话'), { code: 'PROJECT_SCOPE' })
    const report = await waitBoxTask(this.records, groupId, signal)
    await this.projects.writes.run(() => {})
    return report
  }

  saveGroupCandidate(ctx, value, { expectedOutput, passed = false }) {
    const output = validateGroupCandidate(value)
    return this.projects.writes.run(async () => {
      ctx.signal.throwIfAborted()
      const { project_id: id, session_id: sessionId, input_hash: inputHash } = ctx.task.metadata
      const { project } = await this.projects.snapshot(sessionId)
      if (!project || project.basic_info.id !== id || groupFingerprint(project) !== inputHash || digest(groupOutput(project)) !== expectedOutput) throw new Error('项目内容已变化，拒绝覆盖团队结果')
      validateGroupCandidate(output, { segments: project.story_segments.segments })
      const detail = this.records.tasks.detail(this.records.scope, ctx.task.group_id)
      if (detail.tasks.find(task => task.id === ctx.task.id)?.task_status !== 'running') throw new Error('任务已结束，拒绝写入')
      const manager = await ProjectManager.open(join(this.projects.root, 'projects', id, 'project.json'))
      manager.change(next => {
        if (digest(groupOutput(next)) !== digest(output)) expireGroupDependents(next, groupOutput(next).groups, output.groups)
        next.group_setting.groups = output.groups
        delete next.character_extraction.groups
        const state = next.group_setting.node_state
        if (passed && state.opinion?.trim() === ctx.task.metadata.instruction) state.opinion = ''
        next.group_setting.node_state = new NodeStateModel({ ...state, status: 'generated', reason: '', dependency_hash: inputHash }).toJSON()
      })
      ctx.signal.throwIfAborted()
      await manager.model.update()
      this.projects.emit('updated', { project_id: id, session_ids: [sessionId] })
    })
  }

  async changeRules(patch, { sessionId, requestId, reportId, approval, signal }) {
    if (approval !== 'allowed-once') throw new Error('修改规则尚未获得用户授权')
    const previous = this.records.tasks.detail(this.records.scope, reportId)
    if (!previous || previous.tasks[0].node_type !== 'group_setting' || previous.tasks[0].metadata.session_id !== sessionId || boxReport(previous).decision !== 'rule_conflict') throw Object.assign(new Error('需提供当前会话的团队规则冲突报告'), { code: 'PROJECT_SCOPE' })
    const id = digest(['group-rules', sessionId, requestId])
    await this.projects.writes.run(async () => {
      const old = this.records.tasks.detail(this.records.scope, id)
      if (old && (digest(old.tasks[0].metadata.patch) !== digest(patch) || old.tasks[0].metadata.parent_group_id !== reportId)) throw new Error('同一请求ID不能用于不同规则修改')
      if (!old) this.records.tasks.submit(this.records.scope, { group: { id, name: '修改团队规则', source: 'conversation', metadata: { parent_group_id: reportId } },
        tasks: [{ node_type: 'group_rules', action: 'change_rules', name: '修改团队规则', metadata: { project_id: previous.tasks[0].metadata.project_id, session_id: sessionId, patch, approval, parent_group_id: reportId, goal: previous.tasks[0].metadata.goal } }] })
    })
    this.records.tasks.start(this.records.scope)
    return waitBoxTask(this.records, id, signal)
  }
}
