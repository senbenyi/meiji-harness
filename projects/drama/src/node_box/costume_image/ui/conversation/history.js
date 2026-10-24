export const history = {
  taskOutput(task, steps) {
    const generated = steps.findLast(step => step.result?.output)?.result.output
    return { decision: task.task_status === 'completed' ? 'passed' : task.task_status,
      result: task.task_status === 'completed' ? generated || null : null,
      ...(generated && task.task_status !== 'completed' ? { partial_result: { label: '已保存图片，任务未完成', output: generated } } : {}) }
  },
  inputDependencies(task, actual) {
    const { rules, ...input } = task.metadata.input_snapshot || actual || {}
    return input
  },
}
