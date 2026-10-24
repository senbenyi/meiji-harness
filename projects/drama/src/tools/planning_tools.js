import { planningContext } from '../session/planning_context.js'
import { validateRulePatch } from '../node_box/script_revision/rule_change_executor.js'

const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
const text = { type: 'string', minLength: 1 }
const sessionId = exec => {
  const id = exec?.agent?.session?.id
  if (!id) throw new Error('必须从Harness会话调用')
  return id
}

export class PlanningContextTool {
  constructor({ projects, records }) {
    Object.assign(this, { projects, records })
    this.name = 'drama-planning-context'
    this.description = '读取当前项目的盒子报告、项目上游资料、剧本和故事大纲规则及输出、依赖和过期状态。project、script_revision、story_segments、scene_extraction、group_setting、character_extraction、costume_image、shot_design可执行，其他节点暂不能派发。不要猜测依赖或直接读写项目文件。'
    this.parameters = { type: 'object', additionalProperties: false, properties: { report_id: text } }
    this.output = output
  }
  async execute(args, exec) {
    return JSON.stringify(await planningContext(this.projects, this.records, { sessionId: sessionId(exec), reportId: args.report_id }))
  }
}

export class UpdateProjectTool {
  constructor({ projects }) {
    this.projects = projects
    this.name = 'drama-update-project'
    this.description = '根据当前会话的upstream_issue报告修复项目资料。先读取规划上下文，带原值做冲突校验。只使用用户提供的资料；不要编造或擅自改写原始剧本。返回修改任务报告；成功后由主Agent决定是否重试原目标。'
    const fields = { name: text, aspect_ratio: { type: 'string', enum: ['21:9','16:9','4:3','1:1','3:4','9:16'] }, reference_episode_duration_seconds: { type: 'integer', minimum: 1, maximum: 86400 } }
    const info = { type: 'object', additionalProperties: false, properties: fields }
    this.parameters = { type: 'object', additionalProperties: false, properties: { report_id: text,
      command: { oneOf: [
        { type: 'object', additionalProperties: false, properties: { kind: { const: 'basic_info', type: 'string' }, values: info, previous: info }, required: ['kind','values','previous'] },
        { type: 'object', additionalProperties: false, properties: { kind: { const: 'import_script', type: 'string' }, value: text, previousValue: { type: 'string' } }, required: ['kind','value','previousValue'] },
      ] },
    }, required: ['report_id','command'] }
    this.output = output
  }
  async execute(args, exec) {
    return JSON.stringify(await this.projects.editUpstream(args.command, { sessionId: sessionId(exec), requestId: exec.callId, reportId: args.report_id, signal: exec.signal }))
  }
}

export class ChangeRulesTool {
  constructor({ projects, records, scriptRevision, storySegments, sceneExtraction, groupSetting, characterExtraction, shotDesign }) {
    Object.assign(this, { projects, records, scriptRevision, storySegments, sceneExtraction, groupSetting, characterExtraction, shotDesign })
    this.name = 'drama-change-rules'
    this.description = '根据当前项目rule_conflict报告提出单个动作的规则修改。必须提供准确旧值和完整新值；工具通过Harness请求用户对这份具体修改的一次授权，拒绝则不保存。成功后由主Agent携带原报告ID重新派发优化任务。'
    this.parameters = { type: 'object', additionalProperties: false, properties: { report_id: text,
      action: { type: 'string', enum: ['generate','review','revise'] }, field: { type: 'string', enum: ['base','supplement'] },
      previous_value: { type: 'string' }, value: { type: 'string', maxLength: 65536 },
    }, required: ['report_id','action','field','previous_value','value'] }
    this.output = output
  }
  async execute(args, exec) {
    const id = sessionId(exec), { report_id, ...patch } = args
    validateRulePatch(patch)
    const context = await planningContext(this.projects, this.records, { sessionId: id, reportId: report_id })
    if (context.report.decision !== 'rule_conflict') throw new Error('报告不是规则冲突')
    const type = context.report.node_type
    if (!['script_revision', 'story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'shot_design'].includes(type)) throw new Error('此节点暂不支持规则修复')
    if (context[type].rules.rules[patch.action][patch.field] !== patch.previous_value) throw new Error('规则已变化，请重新读取')
    const title = type === 'shot_design' ? '分镜' : type === 'scene_extraction' ? '场景提取' : type === 'group_setting' ? '团队设定' : type === 'character_extraction' ? '角色' : type === 'story_segments' ? '故事大纲' : '剧本优化'
    const approval = await exec.agent.ctx?.approval?.request({ agent: exec.agent, toolName: this.name, callId: exec.callId, signal: exec.signal,
      reason: `修改${title} ${patch.action}.${patch.field}\n原规则：\n${patch.previous_value}\n新规则：\n${patch.value}` }) || 'unavailable'
    if (approval !== 'allowed-once') return JSON.stringify({ status: 'rejected', decision: 'authorization_required', approval, report_id, saved: false })
    const service = type === 'shot_design' ? this.shotDesign : type === 'scene_extraction' ? this.sceneExtraction : type === 'group_setting' ? this.groupSetting : type === 'character_extraction' ? this.characterExtraction : type === 'story_segments' ? this.storySegments : this.scriptRevision
    return JSON.stringify(await service.changeRules(patch, { sessionId: id, requestId: exec.callId, reportId: report_id, approval, signal: exec.signal }))
  }
}
