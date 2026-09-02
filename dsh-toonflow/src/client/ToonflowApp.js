import { createUseProject } from './hooks/useProject.js'
import { createUsePolling } from './hooks/usePolling.js'
import { createConfirmDialog, createProjectDialog } from './components/Modal.js'
import { createDashboard } from './views/Dashboard.js'
import { createExportPanel } from './views/ExportPanel.js'
import { createProjectList } from './views/ProjectList.js'
import { createShotBoard } from './views/ShotBoard.js'
import { createShotDetail } from './views/ShotDetail.js'

export function createToonflowApp(React, api, styles) {
  const { createElement: h, useCallback, useEffect, useState } = React
  const useProject = createUseProject(React, api)
  const usePolling = createUsePolling(React)
  const ProjectList = createProjectList(React)
  const Dashboard = createDashboard(React, api)
  const ShotBoard = createShotBoard(React, api)
  const ShotDetail = createShotDetail(React, api)
  const ExportPanel = createExportPanel(React)
  const ProjectDialog = createProjectDialog(React)
  const ConfirmDialog = createConfirmDialog(React)

  return function ToonflowApp({ ctx, tab }) {
    const meta = tab?.meta || {}
    const [view, setView] = useState(meta.view || 'list')
    const [projectId, setProjectId] = useState(meta.projectId || null)
    const [extra, setExtra] = useState(meta.extra || {})
    const [dialog, setDialog] = useState(null)
    const data = useProject(view, projectId)
    const hasQueued = Boolean(data.plan?.characters?.some(item => item.imageStatus === 'image_queued')
      || data.plan?.shots?.some(item => item.status === 'image_queued' || item.status === 'video_queued'))
    usePolling(view !== 'list' && Boolean(projectId) && hasQueued, data.refreshGeneration)

    const navigate = useCallback((nextView, nextProjectId, nextExtra) => {
      setView(nextView)
      if (nextProjectId !== undefined) {
        if (nextProjectId !== projectId) data.clearPlan()
        setProjectId(nextProjectId)
      }
      const next = nextExtra || {}
      setExtra(next)
      ctx?.get?.('betterSidebar')?.updateTab?.(tab?.id, {
        meta: {
          view: nextView,
          projectId: nextProjectId === undefined ? projectId : nextProjectId,
          extra: next,
        },
      })
    }, [ctx, tab?.id, projectId, data.clearPlan])

    useEffect(() => {
      if (view !== 'list' && data.missingProject) navigate('list', null)
    }, [view, data.missingProject, navigate])

    const onCreate = () => setDialog({ kind: 'create' })
    const onDelete = project => setDialog({ kind: 'delete', project })

    let page
    if (view !== 'list' && data.loading && !data.plan) {
      page = h('div', { className: 'tf-empty' }, '正在加载…')
    } else if (view === 'dashboard') {
      page = h(Dashboard, {
        projectId, plan: data.plan, busy: data.busy, navigate,
        onGenerateCharacter: data.generateCharacter,
      })
    } else if (view === 'shots') {
      page = h(ShotBoard, {
        projectId, plan: data.plan, busy: data.busy, navigate,
        onGenerateImage: data.generateShotImage,
        onGenerateVideo: data.generateShotVideo,
        onRetry: data.retryShot,
      })
    } else if (view === 'shot') {
      page = h(ShotDetail, {
        projectId,
        shotId: extra.shotId,
        plan: data.plan,
        busy: data.busy,
        navigate,
        onUpdate: data.updateShot,
        onGenerateImage: data.generateShotImage,
        onGenerateVideo: data.generateShotVideo,
        onRetry: data.retryShot,
      })
    } else if (view === 'export') {
      page = h(ExportPanel, { projectId, plan: data.plan, navigate })
    } else {
      page = h(ProjectList, {
        projects: data.projects,
        loading: data.loading,
        busy: data.busy,
        onSelect: id => navigate('dashboard', id),
        onCreate,
        onDelete,
      })
    }

    let modal = null
    if (dialog?.kind === 'create') {
      modal = h(ProjectDialog, {
        busy: data.busy,
        onClose: () => setDialog(null),
        onSubmit: async input => {
          if (await data.createProject(input)) setDialog(null)
        },
      })
    } else if (dialog?.kind === 'delete') {
      modal = h(ConfirmDialog, {
        title: '删除项目',
        message: `确认删除项目「${dialog.project.title}」？项目文件和资产会一并删除。`,
        busy: data.busy,
        onClose: () => setDialog(null),
        onConfirm: async () => {
          if (await data.deleteProject(dialog.project.id)) setDialog(null)
        },
      })
    }

    return h('div', { className: 'tf-root' },
      h('style', null, styles),
      data.error ? h('div', { className: 'tf-error' }, data.error) : null,
      page,
      modal,
    )
  }
}
