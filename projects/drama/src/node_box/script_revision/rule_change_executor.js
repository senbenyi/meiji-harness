import { nodeRules } from '../../node_runtime/node_state.js'
import { join } from 'node:path'
import { RulesModel } from '@agent-modules/prompt-composer'
import { NodeStateModel } from '@agent-modules/task/models'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { expireScriptDependents } from './state.js'

export function validateRulePatch(patch) {
  if (!patch || Object.keys(patch).some(key => !['action', 'field', 'value', 'previous_value'].includes(key))
    || !['generate', 'review', 'revise'].includes(patch.action) || !['base', 'supplement'].includes(patch.field)
    || typeof patch.value !== 'string' || typeof patch.previous_value !== 'string'
    || Buffer.byteLength(patch.value) > 65536 || (patch.field === 'base' && !patch.value.trim()))
    throw new TypeError('需提供明确动作、规则字段、旧值及不超过64KiB的新规则')
}

/** 只修改获准的规则字段；保存Model并标记依赖过期，不自行启动下一轮。 */
export class RuleChangeExecutor {
  constructor({ projects, records }) {
    Object.assign(this, { projects, records })
    records.tasks.register('script_rules', {
      label: '剧本规则修改', plan: () => [{ kind: 'change_rules', name: '保存获准的规则修改', executor: 'program' }],
      execute: ctx => this.execute(ctx),
    })
  }

  execute(ctx) {
    return this.projects.writes.run(async () => {
      ctx.signal.throwIfAborted()
      const { patch, approval, project_id: id, session_id: sessionId } = ctx.task.metadata
      if (approval !== 'allowed-once') throw new Error('修改规则未授权')
      validateRulePatch(patch)
      const snapshot = await this.projects.snapshot(sessionId)
      if (!snapshot.project || snapshot.project.basic_info.id !== id) throw new Error('项目已删除或归属改变')
      if (this.projects.activeExecution(id, undefined, ctx.task.group_id)) throw new Error('项目已有任务，请结束后再修改规则')
      const manager = await ProjectManager.open(join(this.projects.root, 'projects', id, 'project.json'))
      manager.change(project => {
        const data = nodeRules(project.basic_info.script_revision_node)
        if (data.rules[patch.action][patch.field] !== patch.previous_value)
          throw Object.assign(new Error('规则已变化，请重新读取并确认修改'), { code: 'EDIT_CONFLICT' })
        if (patch.field === 'supplement' && !data.supports_supplement) throw new Error('当前节点未启用补充规则')
        data.rules[patch.action][patch.field] = patch.value
        project.basic_info.script_revision_node.rules = new RulesModel(data).toJSON().rules
        project.basic_info.script_revision_node = new NodeStateModel({ ...project.basic_info.script_revision_node,
          status: project.basic_info.actual_script ? 'expired' : 'empty', reason: project.basic_info.actual_script ? '规则已修改，等待主Agent重新派发' : '' }).toJSON()
        expireScriptDependents(project)
      })
      ctx.signal.throwIfAborted()
      await manager.model.update()
      this.projects.emit('updated', { project_id: id, session_ids: [sessionId] })
      return { result: { changed: true, reference: '#/basic_info/script_revision_node/rules', parent_group_id: ctx.task.metadata.parent_group_id } }
    })
  }
}
