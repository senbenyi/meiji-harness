// 登录保护由 panel-routes 统一执行；本模块保持同源写入与会话项目归属检查。
export function runRoutes({ service, jobs, json, readJson, base = '/plugins/meiji' }) {
  return async (req, res, url) => {
    const path = url.pathname.slice(base.length), match = /^\/runs(?:\/([A-Za-z0-9_-]+)(?:\/(confirm|resume|pause|cancel|amend|preview)|\/steps\/([A-Za-z0-9_-]+)\/(prompts|responses|artifacts))?)?$/.exec(path)
    if (!match) return false
    if (!service) { json(res, 503, { error: '任务服务未接入' }); return true }
    let jobId
    try {
      const [, id, action, stepId, kind] = match
      if (req.method === 'GET' && !action) {
        const projectId = url.searchParams.get('projectId'), sessionId = url.searchParams.get('sessionId')
        const result = kind ? { [kind]: await service.records(projectId, id, stepId, kind, sessionId) } : id ? { run: await service.get(projectId, id, sessionId) } :
          { runs: await service.list(projectId, sessionId, Object.fromEntries(['episodeId', 'status', 'initiator', 'target'].map(key => [key, url.searchParams.get(key)]))), events: service.projectEvents ? await service.projectEvents(projectId, sessionId) : [] }
        json(res, 200, result); return true
      }
      if (req.method !== 'POST' || kind || id && !action) { json(res, 405, { error: '不支持的请求' }); return true }
      if (req.headers['x-meiji-request'] !== '1') { json(res, 403, { error: '需要同源请求' }); return true }
      const body = await readJson(req, 200000), { projectId, sessionId } = body
      if (!id) { json(res, 201, await service.plan(body, sessionId, 'panel')); return true }
      if (action === 'preview') { json(res, 200, await service.preview(projectId, id, sessionId, body)); return true }
      let run
      if (action === 'confirm') {
        const current = await service.get(projectId, id, sessionId)
        if (current.status !== 'draft') { json(res, 200, { run: current }); return true }
        // 确认校验先完成；jobs 不可用时不能启动执行。
        await service.validateConfirm(projectId, id, sessionId, body)
        if (!current.request?.goal || current.initiator === 'session') {
          jobId = jobs?.bind(current, current.sessionId || sessionId)
          if (!jobId) throw Object.assign(new Error('Harness jobs 服务不可用'), { status: 409, code: 'JOBS_UNAVAILABLE' })
        }
        run = await service.confirm(projectId, id, sessionId, body)
      } else if (action === 'resume') {
        const current = await service.get(projectId, id, sessionId)
        if (!current.request?.goal || current.initiator === 'session') {
          jobId = jobs?.bind(current, current.sessionId || sessionId, { afterRevision: current.revision })
          if (!jobId) throw Object.assign(new Error('Harness jobs 服务不可用'), { status: 409, code: 'JOBS_UNAVAILABLE' })
        }
        run = await service.resume(projectId, id, sessionId, { action: body.action, stepId: body.stepId, authorizePrereq: body.authorizePrereq, confirmDelete: body.confirmDelete }, 'panel')
      } else if (action === 'amend') run = await service.amend(projectId, id, sessionId, body)
      else run = await service[action](projectId, id, sessionId, action === 'cancel' ? body.stepId : undefined)
      json(res, 200, { run, ...(jobId ? { jobId } : {}) })
    } catch (error) { if (jobId) jobs.detach?.(jobId); json(res, error.status || 400, { error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.runId ? { runId: error.runId } : {}), ...(error.deletions ? { deletions: error.deletions } : {}) }) }
    return true
  }
}
