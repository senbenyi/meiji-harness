/** 历史只读业务适配；只从当次记录恢复输入，不读取现在的项目Model。 */
export const taskHistoryPresentation = {
  review(step) {
    const review = step.result?.review
    if (step.kind !== 'review' || !['done', 'rejected'].includes(step.step_status)
      || !['content_issue', 'upstream_issue', 'rule_conflict'].includes(review?.status)) return {}
    return {
      rejected: true,
      type: { content_issue: '内容问题', upstream_issue: '上游资料问题', rule_conflict: '规则冲突' }[review.status],
      reason: (review.issues || []).map(issue => `${issue.location ? `${issue.location}：` : ''}${issue.reason || ''}${issue.suggestion ? `；${issue.suggestion}` : ''}`).join('\n'),
    }
  },
  taskOutput(task, steps) {
    // 只使用该次任务已落盘的事实；不读取现在的项目，也不把最后一个步骤当输出。
    if (['queued', 'running'].includes(task.task_status)) return { result: null }
    const finished = steps.filter(step => ['done', 'rejected'].includes(step.step_status))
    const completed = task.task_status === 'completed'
    const metadata = task.metadata || {}
    if (task.node_type === 'script_revision') {
      const generated = finished.findLast(step => ['generate', 'revise'].includes(step.kind) && step.result?.output)
      const review = finished.findLast(step => step.kind === 'review' && step.seq > (generated?.seq ?? 0) && step.result?.review)?.result.review
      const accepted = completed && review?.status === 'passed'
      return {
        decision: accepted ? 'passed' : task.task_status === 'rejected' ? review?.status || 'content_issue' : task.task_status,
        result: accepted ? generated?.result.output ?? null : null,
        ...(!accepted && generated ? { partial_result: { label: '已保存候选，未作为通过结果交付', output: generated.result.output } } : {}),
        ...(review && !accepted ? { issues: review.issues || [] } : {}),
      }
    }
    if (task.node_type === 'project') {
      const created = finished.findLast(step => step.result?.created)?.result.created
      const changed = finished.some(step => step.kind !== 'extract_summary' && step.result?.changed)
      const imported = finished.findLast(step => step.result?.original_script)?.result
      const output = finished.findLast(step => step.kind === 'extract_summary' && step.result?.output)?.result.output
      const summary = finished.findLast(step => step.result?.original_script_summary)?.result.original_script_summary
      const warning = finished.findLast(step => step.result?.summary_error)?.result.summary_error
      const result = created ? { ...created } : changed ? { changed: true,
        ...(imported ? { original_script: imported.original_script, original_script_filename: imported.original_script_filename, current_script: imported.current_script } : metadata.command?.kind === 'import_script' ? { original_script: metadata.command.value } : {}),
        ...(metadata.command?.kind === 'basic_info' ? { basic_info: metadata.command.values } : {}),
      } : null
      if (result && output) result.output = output
      else if (result && summary) result.original_script_summary = summary
      return { result: completed ? result : null,
        ...(!completed && result ? { partial_result: { label: '已完成的部分操作', output: result } } : {}),
        ...(warning ? { warning } : {}),
      }
    }
    if (task.node_type === 'script_rules') {
      const changed = finished.some(step => step.result?.changed)
      return { result: completed && changed ? { changed: true, action: metadata.patch?.action,
        field: metadata.patch?.field, value: metadata.patch?.value } : null }
    }
    return { result: null }
  },
  inputDependencies(task, steps) {
    const metadata = task.metadata || {}
    const actual = steps.find(step => step.prompt?.input != null)?.prompt.input
    if (task.node_type === 'script_revision') {
      const saved = metadata.input_dependencies ?? metadata.input_snapshot
      if (!saved && actual == null) return null
      const values = { ...saved,
        ...(metadata.language ? { output_language: metadata.language } : {}),
        ...(metadata.instruction ? { instruction: metadata.instruction } : {}),
        ...actual,
      }
      // 盒子外部入参的明确契约；内部规则/审核/步骤快照不能作为输入资料透出。
      return Object.fromEntries(['original_script', 'current_script', 'output_language', 'instruction']
        .filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]))
    }
    if (metadata.input_dependencies != null) return metadata.input_dependencies
    if (task.node_type === 'project') {
      const language = actual?.output_language ? { output_language: actual.output_language } : {}
      if (metadata.info) return { basic_info: metadata.info, ...language }
      if (metadata.command?.kind === 'import_script') return { original_script: metadata.command.value, ...language }
      if (metadata.command?.kind === 'basic_info') return { basic_info: metadata.command.values }
      if (actual?.original_script != null) return { original_script: actual.original_script, ...language }
      return null
    }
    if (task.node_type === 'script_rules') return { changes: metadata.patch, parent_group_id: metadata.parent_group_id }
    return actual ?? null
  },
}
