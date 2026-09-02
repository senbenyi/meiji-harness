import { createUseProject } from './hooks/useProject.js'
import { createDashboard } from './views/Dashboard.js'
import { createExportPanel } from './views/ExportPanel.js'
import { createProjectList } from './views/ProjectList.js'
import { createShotBoard } from './views/ShotBoard.js'
import { createShotDetail } from './views/ShotDetail.js'

export function createToonflowApp(React, api, styles) {
  const { createElement: h, useCallback, useState } = React
  const useProject = createUseProject(React, api)
  const ProjectList = createProjectList(React)
  const Dashboard = createDashboard(React, api)
  const ShotBoard = createShotBoard(React, api)
  const ShotDetail = createShotDetail(React, api)
  const ExportPanel = createExportPanel(React)

  return function ToonflowApp({ ctx, tab }) {
    const meta = tab?.meta || {}
    const [view, setView] = useState(meta.view || 'list')
    const [projectId, setProjectId] = useState(meta.projectId || null)
    const [extra, setExtra] = useState(meta.extra || {})
    const data = useProject(view, projectId)

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
    }, [ctx, tab?.id, projectId])

    async function onCreate() {
      const title = window.prompt('项目名称')
      if (!title?.trim()) return
      const description = window.prompt('项目简介（可选）')
      await data.createProject({ title: title.trim(), description: description || '' })
    }

    async function onDelete(project) {
      if (!window.confirm(`确认删除项目「${project.title}」？项目文件和资产会一并删除。`)) return
      await data.deleteProject(project.id)
    }

    let page
    if (view !== 'list' && data.loading && !data.plan) {
      page = h('div', { className: 'tf-empty' }, '正在加载…')
    } else if (view === 'dashboard') {
      page = h(Dashboard, { projectId, plan: data.plan, navigate })
    } else if (view === 'shots') {
      page = h(ShotBoard, { projectId, plan: data.plan, navigate })
    } else if (view === 'shot') {
      page = h(ShotDetail, {
        projectId,
        shotId: extra.shotId,
        plan: data.plan,
        busy: data.busy,
        navigate,
        onUpdate: data.updateShot,
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

    return h('div', { className: 'tf-root' },
      h('style', null, styles),
      data.error ? h('div', { className: 'tf-error' }, data.error) : null,
      page,
    )
  }
}
