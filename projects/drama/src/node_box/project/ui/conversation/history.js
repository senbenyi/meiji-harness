/** 纯快照展示投影，浏览器与会话展示适配共用；不读取当前项目。 */
export const history = {
  taskOutput(task, finished) {
    const completed = task.task_status === 'completed'
    const metadata = task.metadata || {}

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

  },
  inputDependencies(task, actual) {
    const metadata = task.metadata || {}

    const language = actual?.output_language ? { output_language: actual.output_language } : {}
    if (metadata.info) return { basic_info: metadata.info, ...language }
    if (metadata.command?.kind === 'import_script') return { original_script: metadata.command.value, ...language }
    if (metadata.command?.kind === 'basic_info') return { basic_info: metadata.command.values }
    if (actual?.original_script != null) return { original_script: actual.original_script, ...language }
    return null

  },
}
