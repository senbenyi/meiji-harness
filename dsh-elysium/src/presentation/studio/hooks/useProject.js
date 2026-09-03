export function createUseProject(React, api) {
  const { useCallback, useEffect, useState } = React

  return function useProject(view, projectId) {
    const [projects, setProjects] = useState([])
    const [plan, setPlan] = useState(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [errorCode, setErrorCode] = useState('')
    const [revision, setRevision] = useState(0)

    useEffect(() => {
      if (view !== 'list') return
      let cancelled = false
      setLoading(true)
      setError('')
      setErrorCode('')
      api.fetchJson('/project.list')
        .then(data => { if (!cancelled) setProjects(data.projects || []) })
        .catch(reason => {
          if (!cancelled) {
            setError(reason.message || String(reason))
            setErrorCode(reason.code || '')
          }
        })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [view, revision])

    useEffect(() => {
      if (view === 'list' || !projectId) return
      let cancelled = false
      setLoading(true)
      setError('')
      setErrorCode('')
      api.fetchJson('/plan.get', { projectId })
        .then(data => { if (!cancelled) setPlan(data) })
        .catch(reason => {
          if (!cancelled) {
            setError(reason.message || String(reason))
            setErrorCode(reason.code || '')
          }
        })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [view, projectId, revision])

    const createProject = useCallback(async (input) => {
      setBusy(true)
      setError('')
      setErrorCode('')
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
      setErrorCode('')
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
      setErrorCode('')
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

    const replacePlan = useCallback((data) => {
      if (data?.project?.id === projectId) setPlan(data)
    }, [projectId])

    const refreshGeneration = useCallback(async () => {
      if (!projectId) return null
      try {
        const data = await api.fetchJson('/shot.batch_status', { projectId })
        replacePlan(data)
        return data
      } catch (reason) {
        setError(reason.message || String(reason))
        setErrorCode(reason.code || '')
        return null
      }
    }, [projectId, replacePlan])

    const generate = useCallback(async (route, body) => {
      setBusy(true)
      setError('')
      setErrorCode('')
      try {
        const data = await api.fetchJson(route, { projectId, ...body })
        replacePlan(data)
        return data
      } catch (reason) {
        setError(reason.message || String(reason))
        setErrorCode(reason.code || '')
        setRevision(value => value + 1)
        return null
      } finally {
        setBusy(false)
      }
    }, [projectId, replacePlan])

    const importImage = useCallback(async (scope, entityId, file) => {
      setBusy(true)
      setError('')
      setErrorCode('')
      try {
        const data = await api.uploadImage({ projectId, scope, entityId, file })
        replacePlan(data)
        return data
      } catch (reason) {
        setError(reason.message || String(reason))
        setErrorCode(reason.code || '')
        return null
      } finally {
        setBusy(false)
      }
    }, [projectId, replacePlan])

    const clearPlan = useCallback(() => setPlan(null), [])

    return {
      projects,
      plan: plan?.project?.id === projectId ? plan : null,
      loading,
      busy,
      error,
      missingProject: errorCode === 'PROJECT_NOT_FOUND',
      clearPlan,
      replacePlan,
      refreshGeneration,
      createProject,
      deleteProject,
      updateShot,
      importCharacterImage: (characterId, file) => importImage('characters', characterId, file),
      importShotImage: (shotId, file) => importImage('shots', shotId, file),
      generateCharacter: characterId => generate('/char.generate_image', { characterId }),
      generateShotImage: shotId => generate('/shot.generate_image', { shotId }),
      generateShotVideo: shotId => generate('/shot.generate_video', { shotId }),
      retryShot: shotId => generate('/shot.retry', { shotId }),
    }
  }
}
