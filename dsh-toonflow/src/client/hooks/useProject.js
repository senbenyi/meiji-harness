export function createUseProject(React, api) {
  const { useCallback, useEffect, useState } = React

  return function useProject(view, projectId) {
    const [projects, setProjects] = useState([])
    const [plan, setPlan] = useState(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)

    useEffect(() => {
      if (view !== 'list') return
      let cancelled = false
      setLoading(true)
      setError('')
      api.fetchJson('/project.list')
        .then(data => { if (!cancelled) setProjects(data.projects || []) })
        .catch(reason => { if (!cancelled) setError(reason.message || String(reason)) })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [view, revision])

    useEffect(() => {
      if (view === 'list' || !projectId) return
      let cancelled = false
      setLoading(true)
      setError('')
      api.fetchJson('/plan.get', { projectId })
        .then(data => { if (!cancelled) setPlan(data) })
        .catch(reason => { if (!cancelled) setError(reason.message || String(reason)) })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [view, projectId, revision])

    const createProject = useCallback(async (input) => {
      setBusy(true)
      setError('')
      try {
        const result = await api.fetchJson('/project.create', input)
        setRevision(value => value + 1)
        return result
      } catch (reason) {
        setError(reason.message || String(reason))
        return null
      } finally {
        setBusy(false)
      }
    }, [])

    const deleteProject = useCallback(async (id) => {
      setBusy(true)
      setError('')
      try {
        await api.fetchJson('/project.delete', { projectId: id })
        setProjects(current => current.filter(item => item.id !== id))
        return true
      } catch (reason) {
        setError(reason.message || String(reason))
        return false
      } finally {
        setBusy(false)
      }
    }, [])

    const updateShot = useCallback(async (shotId, updates) => {
      setBusy(true)
      setError('')
      try {
        const data = await api.fetchJson('/plan.update_shot', { projectId, shotId, updates })
        setPlan(current => current ? {
          ...current,
          project: data.project || current.project,
          summary: data.summary || current.summary,
          shots: current.shots.map(shot => shot.id === shotId ? data.shot : shot),
        } : current)
        return data
      } catch (reason) {
        setError(reason.message || String(reason))
        return null
      } finally {
        setBusy(false)
      }
    }, [projectId])

    return {
      projects,
      plan: plan?.project?.id === projectId ? plan : null,
      loading,
      busy,
      error,
      clearPlan: () => setPlan(null),
      createProject,
      deleteProject,
      updateShot,
    }
  }
}
