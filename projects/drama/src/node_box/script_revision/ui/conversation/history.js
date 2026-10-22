/** 纯快照展示投影，浏览器与会话展示适配共用；不读取当前项目。 */
export const history = {
  taskOutput(task, finished) {
    const completed = task.task_status === 'completed'
    const metadata = task.metadata || {}

    const generated = finished.findLast(step => ['generate', 'revise'].includes(step.kind) && step.result?.output)
    const review = finished.findLast(step => step.kind === 'review' && step.seq > (generated?.seq ?? 0) && step.result?.review)?.result.review
    const accepted = completed && review?.status === 'passed'
    return {
      decision: accepted ? 'passed' : task.task_status === 'rejected' ? review?.status || 'content_issue' : task.task_status,
      result: accepted ? generated?.result.output ?? null : null,
      ...(!accepted && generated ? { partial_result: { label: '已保存候选，未作为通过结果交付', output: generated.result.output } } : {}),
      ...(review && !accepted ? { issues: review.issues || [] } : {}),
    }

  },
  inputDependencies(task, actual) {
    const metadata = task.metadata || {}

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

  },
}

export const rulesHistory = {
  taskOutput(task, finished) {
    const completed = task.task_status === 'completed'
    const metadata = task.metadata || {}

    const changed = finished.some(step => step.result?.changed)
    return { result: completed && changed ? { changed: true, action: metadata.patch?.action,
      field: metadata.patch?.field, value: metadata.patch?.value } : null }

  },
  inputDependencies(task) {
    const metadata = task.metadata || {}
    return { changes: metadata.patch, parent_group_id: metadata.parent_group_id }
  },
}
