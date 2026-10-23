import { boxReport } from '../node_runtime/box_report.js'

/** 所有输入/输出取当次Task/Step事实，禁止用最新Project填补历史。 */
export function displayContext(detail, task, step) {
  const metadata = task.metadata || {}
  const { rules: snapshotRules, ...savedInput } = metadata.input_snapshot || {}
  const boxInput = metadata.input_snapshot ? savedInput : metadata.info || (metadata.command ? { command: metadata.command } : null)
  const input = step ? step.prompt?.input ?? (step.executor === 'program' ? boxInput : null) : boxInput
  const script = input?.basic_info?.actual_script ?? input?.current_script?.actual_script ?? input?.original_script
  const previous = step && detail.steps.some(row => row.task_id === task.id && row.seq < step.seq && ['generate', 'revise'].includes(row.kind))
  const origin = task.node_type === 'story_segments' ? '当前工作稿与故事大纲' : typeof script === 'string' ? (step?.kind === 'review' ? '本次候选稿' : previous ? '上一步候选稿与审核意见' : input?.original_script !== undefined ? '原始剧本' : '当前工作稿') : '本次任务参数'
  const last = detail.steps.findLast(row => row.task_id === task.id && !['ready', 'running', 'skipped'].includes(row.step_status))
  const active = detail.steps.find(row => row.task_id === task.id && row.step_status === 'running')
  const report = boxReport(detail)
  const candidate = detail.steps.findLast(row => row.task_id === task.id && (row.result?.output?.actual_script || row.result?.output?.segments))?.result.output
  const duration = task.started_at && task.ended_at ? Math.max(0, Math.round((Date.parse(task.ended_at) - Date.parse(task.started_at)) / 1000)) : null
  const name = metadata.project_name || metadata.info?.name || ''
  return {
    node_type: task.node_type, source: detail.group.source, operation_name: task.name, project_name: name, action: task.action,
    box_input_description: { origin: boxInput?.basic_info || boxInput?.current_script ? '当前工作稿' : boxInput?.original_script !== undefined ? '原始剧本' : '本次任务参数', project_name: name,
      ...(typeof (boxInput?.basic_info?.actual_script ?? boxInput?.current_script?.actual_script ?? boxInput?.original_script) === 'string' ? { characters: [...(boxInput.basic_info?.actual_script ?? boxInput.current_script?.actual_script ?? boxInput.original_script)].length } : {}) },
    input_ref: { task_id: task.id, ...(step ? { step_id: step.id } : {}) },
    input_available: input !== null,
    input_description: { origin, ...(name ? { project_name: name } : {}),
      ...(typeof script === 'string' ? { characters: [...script].length } : {}),
      language: input?.output_language || metadata.language || '',
      has_rules: Boolean(metadata.input_snapshot?.rules),
      has_review_issues: Boolean(input?.review_issues?.length),
    },
    operation_status: task.task_status,
    active_step: active ? { name: active.name, seq: active.seq, round: active.round } : null,
    saved: report.saved, stop_reason: task.end_reason || '',
    stopped_at: last ? `${last.seq}. ${last.name}${last.round ? `（第${last.round}轮）` : ''}` : '尚未开始执行步骤',
    revision_count: detail.steps.filter(row => row.task_id === task.id && row.kind === 'revise' && row.round > 0 && row.step_status === 'done').length,
    duration_seconds: duration,
    // 完整资料仅供详情使用，轮询时移除。
    box_input: structuredClone(boxInput),
    input: input === null ? null : structuredClone(input),
    rules: structuredClone(snapshotRules || null),
    final_output: task.task_status === 'completed' && report.saved ? structuredClone(candidate || null) : null,
    step_name: step?.name || '',
  }
}

export function compactDisplay(card) {
  const { input, box_input, rules, final_output, result, summary, ...compact } = card
  return compact
}
