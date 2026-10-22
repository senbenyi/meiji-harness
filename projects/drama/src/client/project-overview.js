import { showToast } from '@agent-modules/ui'
import { taskHistoryPresentation } from './task-presentation.js'
import { element } from './panel-dom.js'
import { detailsDialog } from './project-forms.js'
import { renderProjectDetails } from './project-detail.js'
import { renderProjectProduction } from './project-production.js'
import { scriptNodeCard, backHeader } from './project-node.js'
import { scriptImport } from './script-import.js'
import { createTaskHistory } from '@agent-modules/task/ui'
import { createHttpHistory } from '@agent-modules/http-client/ui'
import { renderRulesPanel } from '@agent-modules/prompt-composer/ui'

// 标题、编辑图标和剧本卡片结构复制自meiji/client/project-ui.js，按drama模型独立维护。
const editIcon = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.7 2.3 13.7 6.3 5.4 14.6H1.4v-4L9.7 2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
const button = (label, action, name) => { const node = element('button', label); node.type = 'button'; node.onclick = action; if (name) node.setAttribute('aria-label', name); return node }

/** meiji风格的基本资料/剧本视图；state由外层保存，所有写入通过save回调。 */
export function createProjectView(root, { project: initialProject, save, refresh, request, remove, optimize, scriptExecution: initialExecution = null, summaryExecution: initialSummaryExecution = null, confirmDelete = message => root.ownerDocument.defaultView.confirm(message), dialogRoot = root, state = {} } = {}) {
  let sourceRead = 0
  let project = initialProject, execution = initialExecution, summaryExecution = initialSummaryExecution, disposed = false, recordView, disposeImport
  state.mode ||= 'overview'
  const ownedDialogs = new Set()
  const go = mode => { state.mode = mode; paint() }
  const persist = async command => {
    const next = await save(command)
    if (!disposed && next?.basic_info) { project = next; if (state.mode !== 'rules') paint() }
  }
  const edit = (title, values, makeCommand) => {
    if (disposed) return
    const dialog = detailsDialog(dialogRoot, title, values, fields => persist(makeCommand(fields)))
    dialog.dataset.projectEditor = project.basic_info.id
    ownedDialogs.add(dialog)
    dialog.addEventListener('close', () => ownedDialogs.delete(dialog), { once: true })
  }
  const editBasic = () => {
    const previous = Object.fromEntries(['name', 'aspect_ratio', 'reference_episode_duration_seconds'].map(key => [key, project.basic_info[key]]))
    edit('编辑项目', previous, values => ({ kind: 'basic_info', values, previous }))
  }
  const openRules = (type = 'script_revision', title = '剧本优化') => { state.ruleReturn = state.mode; state.ruleNodeType = type; state.ruleNodeTitle = title; go('rules') }
  const openRecords = (mode, type = 'script_revision', title = '剧本优化') => { state.recordReturn = state.mode; state.recordNodeType = type; state.recordNodeTitle = title; go(mode) }
  function paint() {
    if (disposed) return
    recordView?.dispose(); recordView = null
    disposeImport?.(); disposeImport = null
    root.replaceChildren()
    if (state.mode === 'tasks' || state.mode === 'http') {
      const projectId = project.basic_info.id, nodeType = state.recordNodeType || 'script_revision', nodeTitle = state.recordNodeTitle || '剧本优化'
      const read = (path, filter = {}) => request(`${path}?${new URLSearchParams({ ...filter, project_id: projectId, node_type: nodeType })}`)
      const onBack = () => go(['script', 'production'].includes(state.recordReturn) ? state.recordReturn : 'overview')
      recordView = state.mode === 'tasks' ? createTaskHistory({ document: root.ownerDocument, onNotify: (message, options) => showToast(message, { ...options, document: root.ownerDocument }), presentation: taskHistoryPresentation, title: `${nodeTitle} · 任务记录`, onBack,
        nodeTypes: [{ type: nodeType, label: nodeTitle }], initialView: { node_type: nodeType }, source: {
          history: filter => read('task-history', filter), detail: async id => (await read('task-history', { id })).detail,
        } }) : createHttpHistory({ document: root.ownerDocument, onBack, source: {
          list: async filter => (await read('http-records', filter)).records, read: async id => (await read('http-records', { id })).record,
        } })
      root.append(recordView.element)
      return
    }
    if (state.mode === 'rules') {
      const nodeType = state.ruleNodeType || 'script_revision', nodeTitle = state.ruleNodeTitle || '剧本优化'
      if (!(nodeType === 'script_revision' ? project.basic_info.script_revision_node : project[nodeType]?.node_state)?.rules) { go(state.ruleReturn || 'overview'); return }
      const ruleState = nodeType === 'script_revision' ? project.basic_info.script_revision_node : project[nodeType].node_state
      root.append(renderRulesPanel({ supports_supplement: ruleState.supports_supplement, rules: ruleState.rules }, { title: `${nodeTitle}规则`, document: root.ownerDocument,
        baseLabel: '基础规则', ruleNote: nodeType === 'script_revision' ? '这里展示项目内保存的规则。各动作的补充规则独立保存。' : '这里展示项目内保存的规则，当前仅供查看。',
        onBack: () => go(['script', 'production'].includes(state.ruleReturn) ? state.ruleReturn : 'overview'),
        onSave: nodeType === 'script_revision' ? change => persist({ kind: 'rules', node_type: nodeType, ...change }) : undefined,
      }))
      return
    }
    const view = element('section', '', state.mode === 'overview' ? 'project-overview overview-page' : 'project-script-page')
    root.append(view)
    if (state.mode === 'production') {
      renderProjectProduction(view, project, { state, onBack: () => go('overview'),
        openTasks: request ? (type, title) => openRecords('tasks', type, title) : undefined, openRules,
        saveOpinion: save ? (type, value, previousValue) => persist({ kind: 'node_opinion', node_type: type, value, previousValue }) : undefined,
      })
      return
    }
    const nodeCard = () => scriptNodeCard({ ...project.basic_info, node_state: project.basic_info.script_revision_node }, {
      preview: state.mode === 'overview',
      canOptimize: !!project.basic_info.actual_script.trim(), busy: !!execution || !!state.submittingOptimization,
      executionStep: execution?.status === 'running' ? execution.step : null, reviewIssues: execution?.review_issues || [],
      displayNodeState: execution?.node_state_before || (state.submittingOptimization ? state.optimizationNodeState : null),
      executionError: state.optimizationError || '',
      runOptimization: optimize ? async instruction => {
        state.optimizationError = ''; state.optimizationNodeState = structuredClone(project.basic_info.script_revision_node); state.submittingOptimization = true
        if (!state.optimizationRequest || state.optimizationRequest.instruction !== instruction)
          state.optimizationRequest = { instruction, id: root.ownerDocument.defaultView.crypto.randomUUID() }
        paint()
        try {
          const result = await optimize(instruction, state.optimizationRequest.id)
          if (disposed) return
          execution = { group_id: result.group_id, status: result.status, node_state_before: state.optimizationNodeState }
          state.optimizationRequest = null
          refresh?.()
        } catch (error) { state.optimizationError = error.message; throw error }
        finally { state.submittingOptimization = false; if (!disposed) paint() }
      } : undefined,
      openRules: project.basic_info.script_revision_node.rules ? () => openRules() : undefined,
      openTasks: request ? () => openRecords('tasks') : undefined,
      openHttp: request ? () => openRecords('http') : undefined,
      opinionDraft: state.opinionDraft ?? project.basic_info.script_revision_node.opinion,
      setOpinionDraft: value => { state.opinionDraft = value },
      saveOpinion: (value, previousValue) => persist({ kind: 'node_opinion', value, previousValue }),
    })
    if (state.mode === 'original-script') {
      backHeader(view, '原始剧本', '返回项目概要', () => go('overview'))
      const body = element('p', project.basic_info.original_script_file_path ? '正在读取…' : '尚未导入原始剧本', 'prompt original-script-full')
      view.append(body)
      const ticket = ++sourceRead, reference = project.basic_info.original_script_file_path
      if (reference && request) request('original-script').then(result => {
        if (!disposed && ticket === sourceRead && state.mode === 'original-script' && project.basic_info.original_script_file_path === reference) body.textContent = result.body
      }).catch(error => { if (!disposed && ticket === sourceRead && state.mode === 'original-script') body.textContent = error.message })
      else if (reference) body.textContent = '请通过项目服务读取原始剧本'
      return
    }
    if (state.mode === 'script') {
      backHeader(view, '剧本详情', '返回项目概要', () => go('overview'))
      view.append(nodeCard())
      return
    }
    const heading = element('div', '', 'title-with-edit'), editControl = button('', editBasic, '编辑基本信息')
    editControl.className = 'icon-edit'; editControl.innerHTML = editIcon
    heading.append(element('h2', project.basic_info.name), editControl)
    const deleteError = element('p', '', 'error project-delete-error')
    deleteError.setAttribute('role', 'alert')
    if (remove) {
      const control = button('删除', async () => {
        if (disposed || !confirmDelete(`删除项目“${project.basic_info.name}”及对应工作区？会话、磁盘文件和历史记录保留。`)) return
        control.disabled = true; deleteError.textContent = ''
        try { await remove() }
        catch (error) { if (!disposed) deleteError.textContent = error.message }
        finally { if (!disposed) control.disabled = false }
      }, '删除项目')
      control.className = 'project-delete'
      heading.append(control)
    }
    const next = button('下一步', () => go('production'))
    next.className = 'project-next'
    heading.append(next)
    view.append(heading, deleteError)
    const basic = renderProjectDetails(view, project.basic_info, { onViewScript: () => go('original-script'), summaryExecution })
    const previousScript = project.basic_info.original_script_file_path
    disposeImport = scriptImport(basic.querySelector('.original-script-heading'), { importScript: (value, originalName) => persist({ kind: 'import_script', value, originalName, previousValue: previousScript }),
      listScripts: request ? async () => (await request('library')).assets : undefined,
      readScript: request ? async id => (await request(`library/scripts/${encodeURIComponent(id)}`)).body : undefined,
    })
    const script = nodeCard()
    script.classList.add('overview-card')
    const detail = button('查看剧本', () => go('script'), '查看优化剧本'); detail.className = 'script-view'
    script.querySelector('.section-head').append(detail)
    view.append(script)
  }
  paint()
  return { get isShowingRecords() { return ['tasks', 'http'].includes(state.mode) }, update(next, { scriptExecution = execution, summaryExecution: nextSummaryExecution = summaryExecution } = {}) { if (disposed) return; const unchanged = JSON.stringify(project) === JSON.stringify(next) && JSON.stringify(execution) === JSON.stringify(scriptExecution) && JSON.stringify(summaryExecution) === JSON.stringify(nextSummaryExecution); if (next.basic_info.script_revision_node?.status === 'generated' && next.basic_info.script_revision_node.opinion === ''
      && project.basic_info.script_revision_node.opinion && state.opinionDraft === project.basic_info.script_revision_node.opinion) state.opinionDraft = ''
    project = next; execution = scriptExecution; summaryExecution = nextSummaryExecution; if (!unchanged && !['rules', 'tasks', 'http'].includes(state.mode)) paint() }, dispose() {
    if (disposed) return
    disposed = true
    recordView?.dispose()
    disposeImport?.()
    for (const dialog of ownedDialogs) dialog.close()
    root.replaceChildren()
  } }
}
