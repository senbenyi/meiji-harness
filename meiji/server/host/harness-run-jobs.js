// 只观察注入的 Run 服务；host 不引用 flow/runtime/data。
export function createHarnessRunJobs({ home, registry, readRun, cancelRun, subscribeProject }) {
  const observers = new Map(), sources = new Map()
  return {
    bind(run, sessionId, { afterRevision = null, source = run.initiator } = {}) {
      if (!registry?.start) throw Object.assign(new Error('Harness jobs 服务不可用'), { status: 409, code: 'JOBS_UNAVAILABLE' })
      let jobId, enteredId
      try { jobId = registry.start({ kind: 'meiji-run', owner: sessionId, label: `制作任务 ${run.goal.to}`, outputLimitBytes: 16384,
        run: job => {
          enteredId = job.id
          let resolve, stopped = false, checking = false, again = false
          const done = new Promise(accept => { resolve = accept })
          const unsubscribe = subscribeProject(home, run.projectId, () => { void inspect() })
          const settle = outcome => { if (stopped) return; stopped = true; unsubscribe(); observers.delete(job.id); resolve(outcome) }
          async function inspect() {
            if (stopped) return
            if (checking) { again = true; return }
            checking = true
            try {
              do {
                again = false
                const current = await readRun(run.projectId, run.id, sessionId)
                if (stopped) return
                const steps = current.steps.filter(step => step.status !== 'superseded')
                job.updateProgress(`${steps.filter(step => ['done', 'skipped'].includes(step.status)).length}/${steps.length}`)
                if (['paused', 'completed', 'failed', 'cancelled'].includes(current.status) && !(current.status === 'paused' && afterRevision !== null && current.revision <= afterRevision)) {
                  const result = { runId: current.id, projectId: current.projectId, episodeId: current.episodeId, status: current.status, pause: current.pause, failure: current.failure || null,
                    actions: [...new Set(current.pause?.reasons.flatMap(reason => reason.actions) || [])] }
                  settle({ status: current.status === 'cancelled' ? 'killed' : 'completed', result: JSON.stringify(result) })
                }
              } while (again && !stopped)
            } catch (error) { settle({ status: 'failed', detail: error.message }) }
            finally { checking = false }
          }
          const observer = { done, cancel(reason) {
            if (stopped) return
            if (!['owner disposed', 'jobs service disposed'].includes(reason)) void cancelRun(run.projectId, run.id, sessionId).catch(() => {})
            settle({ status: 'killed', detail: reason || '停止观察' })
          } }
          observers.set(job.id, observer)
          void inspect()
          return observer
        },
      }) } catch (cause) {
        if (enteredId) observers.get(enteredId)?.cancel('owner disposed')
        throw Object.assign(new Error(`后台任务登记失败：${cause.message}`), { status: 409, code: 'JOBS_UNAVAILABLE' })
      }
      sources.set(jobId, source)
      return jobId
    },
    guard(exec) {
      // 面板控制由用户操作入口处理，模型不能借 job_kill 停止制作任务。
      if (exec.name === 'job_kill' && sources.get(exec.arguments?.job_id) === 'panel') return '请通过任务面板处理制作任务'
    },
    detach(id) { observers.get(id)?.cancel('owner disposed') },
    dispose() { for (const observer of [...observers.values()]) observer.cancel('owner disposed'); sources.clear() },
  }
}
