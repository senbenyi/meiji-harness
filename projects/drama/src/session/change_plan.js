import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { ProjectManager } from '../project_runtime/project_manager.js'
import { boxReport } from '../node_runtime/box_report.js'
import { scriptOutput } from '../node_runtime/node_state.js'

const escapePointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1')

/** 目标只来自已有项目节点；不接受模型提供任意写入路径。 */
export function planningTargets(project) {
  const targets = []
  const visit = (value, path, nodeType) => {
    if (!value || typeof value !== 'object') return
    if (value.node_state) targets.push({ target: path, node_type: nodeType, state: value.node_state.status })
    for (const [key, child] of Object.entries(value)) {
      if (!['node_state', 'rules'].includes(key)) visit(child, `${path}/${escapePointer(key)}`, nodeType)
    }
  }
  targets.push({ target: '/basic_info/script_revision_node', node_type: 'script_revision', state: project.basic_info.script_revision_node.status })
  for (const type of ['story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'shot_design', 'clip_arrangement', 'video_prompt', 'videos', 'episodes']) visit(project[type], `/${type}`, type)
  return targets.map(row => {
    const image = row.target.match(/^\/(scene_extraction|character_extraction)\/assets\/(\d+)\/(image_generation|costume_images\/\d+)$/)
    if (!image) return { ...row, path: row.target }
    const asset = project[image[1]].assets[Number(image[2])]
    if (image[3] === 'image_generation') return { ...row, path: row.target, target: `scene_image:${JSON.stringify(asset.scene_id)}`, node_type: 'scene_image', scene_id: asset.scene_id }
    const photo = asset.costume_images[Number(image[3].split('/')[1])]
    return { ...row, path: row.target, target: `costume_image:${JSON.stringify([asset.character_id, photo.costume_id])}`, node_type: 'costume_image', character_id: asset.character_id, costume_id: photo.costume_id }
  })
}

function targetState(project, target) {
  const value = target.split('/').slice(1).reduce((row, key) => row[key.replaceAll('~1', '/').replaceAll('~0', '~')], project)
  return target === '/basic_info/script_revision_node' ? value : value.node_state
}

function reportFor(records, id, sessionId, projectId) {
  const detail = records.tasks.detail(records.scope, id)
  if (!detail || detail.tasks[0].metadata.project_id !== projectId || boxReport(detail).session_id !== sessionId) throw new Error('报告不属于当前项目会话')
  return { report: boxReport(detail), task: detail.tasks[0] }
}

/** 主Agent的工作记录，不创建盒子或Task；所有业务修改仍通过原盒子执行。 */
export async function saveChangePlan(projects, records, args, sessionId) {
  if (!args || Object.keys(args).some(key => !['report_id', 'previous_revision', 'goal', 'decisions'].includes(key))) throw new TypeError('规划参数含未声明字段')
  if (typeof args.report_id !== 'string' || !args.report_id.trim() || !Number.isInteger(args.previous_revision) || args.previous_revision < 0
    || typeof args.goal !== 'string' || !args.goal.trim() || args.goal.length > 10000 || !Array.isArray(args.decisions) || !args.decisions.length) throw new TypeError('需提供报告、规划版本、目标和上下游处理决定')
  return projects.writes.run(async () => {
    const { project } = await projects.snapshot(sessionId)
    if (!project) throw new Error('当前会话没有项目')
    const id = project.basic_info.id
    if (projects.activeExecution(id)) throw new Error('项目任务正在执行，请结束后再更新联动规划')
    const { report: source } = reportFor(records, args.report_id, sessionId, id)
    if (!source.saved || !['passed', 'upstream_issue'].includes(source.decision)) throw new Error('仅已保存且通过或明确上游问题的报告可进入联动规划')
    const manager = await ProjectManager.open(join(projects.root, 'projects', id, 'project.json'))
    const next = manager.read(), plans = next.change_plans ||= {}
    const previous = plans[args.report_id]
    if ((previous?.revision || 0) !== args.previous_revision) throw new Error('联动规划已变化，请重新读取')
    const targets = new Map(planningTargets(next).map(row => [row.target, row]))
    const seen = new Set()
    const decisions = args.decisions.map(decision => {
      if (!decision || Object.keys(decision).some(key => !['target', 'action', 'reason', 'result_report_id'].includes(key))
        || !targets.has(decision.target) || seen.has(decision.target) || !['keep', 'update', 'regenerate', 'defer'].includes(decision.action)
        || typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 10000) throw new TypeError('目标、处理动作或原因无效，目标不可重复')
      seen.add(decision.target)
      const target = targets.get(decision.target), state = targetState(next, target.path)
      if (decision.action === 'keep' && (state.status === 'rejected'
        || state.status === 'expired' && state.last_execution && state.last_execution.status !== 'completed')) throw new Error('目标尚未通过本地审核，不能确认保留')
      let status = decision.action === 'keep' ? 'done' : 'pending'
      if (decision.result_report_id !== undefined) {
        if (!['update', 'regenerate'].includes(decision.action) || typeof decision.result_report_id !== 'string') throw new TypeError('仅修改或重新生成可关联执行结果')
        const { report, task } = reportFor(records, decision.result_report_id, sessionId, id)
        if (report.status !== 'completed' || !report.saved) throw new Error('关联执行尚未成功保存')
        if (decision.result_report_id === args.report_id) throw new Error('不能用原修改报告冒充后续联动执行结果')
        const image = target.path.match(/^\/(scene_extraction|character_extraction)\/assets\/(\d+)\/(image_generation|costume_images\/\d+)$/)
        if (image) {
          const asset = next[image[1]].assets[Number(image[2])]
          const photo = image[3] === 'image_generation' ? null : asset.costume_images[Number(image[3].split('/')[1])]
          if (report.node_type !== (photo ? 'costume_image' : 'scene_image') || (photo ? task.metadata.character_id !== asset.character_id || task.metadata.costume_id !== photo.costume_id : task.metadata.scene_id !== asset.scene_id)) throw new Error('执行结果与素材目标不匹配')
          if (report.review_packet?.candidate?.address !== (photo || asset.image_generation).address) throw new Error('素材已变化，请重新检查执行结果')
        } else if (report.node_type !== target.node_type) throw new Error('执行结果与规划节点不匹配')
        else {
          const key = { story_segments: 'segments', scene_extraction: 'scenes', group_setting: 'groups', character_extraction: 'characters', shot_design: 'shots' }[target.node_type]
          const current = target.node_type === 'script_revision' ? scriptOutput(next) : key ? { [key]: next[target.node_type][key] } : null
          if (!current || !isDeepStrictEqual(current, report.change?.after)) throw new Error('节点内容已变化，请重新检查执行结果')
        }
        if (state.status !== 'generated') throw new Error('目标当前尚未生成或仍未通过，不能完成规划项')
        status = 'done'
      }
      // 保留仅能确认既有过期内容，不得把本地审核失败伪装成通过。
      if (decision.action === 'keep' && state.status === 'expired') Object.assign(state, { status: 'generated', reason: '' })
      if (status === 'pending' && state.status === 'generated') Object.assign(state, { status: 'expired', reason: `主Agent联动规划：${decision.reason}` })
      return { ...structuredClone(decision), status }
    })
    const plan = { report_id: args.report_id, goal: args.goal.trim(), revision: args.previous_revision + 1,
      decisions, status: decisions.every(row => row.status === 'done') ? 'completed' : 'pending', updated_at: new Date().toISOString() }
    plans[args.report_id] = plan
    manager.change(draft => Object.assign(draft, next))
    await manager.model.update()
    projects.emit('updated', { project_id: id, session_ids: [sessionId] })
    return { project_id: id, plan }
  })
}
