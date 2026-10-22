import { element } from './panel-dom.js'

export function renderProjectDetails(root, info, { onViewScript, summaryExecution = null } = {}) {
  const section = element('section', '', 'overview-card')
  section.dataset.section = 'basic_info'
  for (const [label, value] of [
    ['项目ID', info.id], ['项目名称', info.name],
    ['创作模式', info.creation_mode], ['画幅', info.aspect_ratio],
    ['预估时长', info.estimated_duration_seconds > 0 ? `${info.estimated_duration_seconds} 秒` : '未生成'],
    ['参考单集时长', `${info.reference_episode_duration_seconds} 秒`],
  ]) {
    const line = element('p', '', 'project-info-line')
    line.append(element('strong', `${label}：`), document.createTextNode(String(value)))
    section.append(line)
  }
  const original = element('div', '', 'original-script')
  const heading = element('div', '', 'original-script-heading')
  heading.append(element('h3', '原始剧本'))
  if (summaryExecution) {
    const loading = element('span', '', 'original-summary-loading')
    loading.setAttribute('role', 'status'); loading.setAttribute('aria-label', '原始剧本摘要生成中')
    heading.append(loading)
  }
  if (info.original_script_file_path?.trim() && onViewScript) {
    const view = element('button', '查看剧本', 'script-view')
    view.type = 'button'; view.onclick = onViewScript; heading.append(view)
  }
  const summary = info.original_script_file_path?.trim() ? info.summary || (summaryExecution ? '正在生成摘要…' : '暂无摘要') : '尚未导入原始剧本'
  original.append(heading)
  if (info.original_script_file_path?.split('/').at(-1)) original.append(element('p', info.original_script_file_path?.split('/').at(-1), 'meta original-script-filename'))
  original.append(element('p', `摘要：${summary}`, 'summary original-script-summary'))
  section.append(original)
  root.append(section)
  return section
}
