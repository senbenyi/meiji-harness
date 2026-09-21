// 职责：将项目存储操作适配为经过认证的 HTTP 路由。
import { withConfig } from '../../config.js'
import { createProjectStore } from '../projects/service.js'
import { createDirectorStore } from '../directors/service.js'
import { validProjectId } from '../projects/schema.js'
import { authenticated, invalidRequest, json, readJsonBody } from '../http.js'

export const PROJECT_ROUTE = '/plugins/dsh-elysium/project'
const reads = ['list', 'get', 'episode', 'poll']
const actions = [...reads, 'create', 'update', 'delete', 'import', 'anchor-generate', 'anchors-confirm', 'project-suggest', 'plan-generate', 'plan-edit', 'plan-finalize', 'plan-read',
  'reshoot', 'retry', 'auto-start', 'auto-pause', 'auto-resume']
const exactBody = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key))
const shotBody = body => exactBody(body, ['project_id', 'episode', 'shot_id'])

export function createProjectHandler(options) {
  const { token } = options
  const directors = options.directorStore || createDirectorStore()
  const store = options.projectStore || createProjectStore({ ...options, directorExists: name => directors.has(name) })
  const handlers = {
    'project-suggest': body => store.planning.suggestProject(body),
    'plan-generate': body => store.planning.generate(body),
    'plan-edit': body => store.planning.edit(body),
    'plan-finalize': body => store.planning.finalize(body),
    'plan-read': body => store.planning.read(body),
    'anchor-generate': body => store.generateAnchorImage(body),
    'anchors-confirm': body => store.confirmAnchors(body),
    'auto-start': body => store.startAuto(body),
    'auto-pause': body => store.pauseAuto(body),
    'auto-resume': body => store.resumeAuto(body),
    reshoot: body => { if (!shotBody(body)) throw invalidRequest('重拍参数无效'); return store.reshootShot(body) },
    retry: body => { if (!shotBody(body)) throw invalidRequest('恢复参数无效'); return store.retryShot(body) },
  }
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(PROJECT_ROUTE.length + 1)
      if (!actions.includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (reads.includes(action) ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      if (action === 'list') return json(res, 200, await store.list())
      if (action === 'get' || action === 'poll') {
        const id = url.searchParams.get('id')
        if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
        if (action === 'poll') {
          const since = Number(url.searchParams.get('since'))
          if (!url.searchParams.has('since') || !url.searchParams.get('since').trim() || !Number.isSafeInteger(since) || since < 0) throw invalidRequest('变更时间无效')
          return json(res, 200, { updated: await store.lastModified(id) > since })
        }
        return json(res, 200, await store.read(id))
      }
      if (action === 'episode') return json(res, 200, await store.readEpisode(url.searchParams.get('id'), Number(url.searchParams.get('number'))))
      const body = await readJsonBody(req)
      if (handlers[action]) return json(res, 200, await handlers[action](body))
      return json(res, action === 'create' ? 201 : 200, await store.change(action, body))
    } catch (error) {
      const missing = ['ENOENT', 'MODEL_JOB_NOT_FOUND'].includes(error.code)
      json(res, error.status || (missing ? 404 : 503), { error: error.status ? error.message : missing ? '项目或素材不存在' : '暂时无法读取或保存项目' })
    }
  }
}

export function registerProjectRoutes(ctx, runtime, token, projectStore) {
  const server = ctx.get?.('webServer')
  if (!server) return
  const handle = createProjectHandler({ token, projectStore })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of actions) ctx.effect(() => server.register({ kind: 'exact', path: `${PROJECT_ROUTE}/${suffix}`, handler }), `elysium project ${suffix}`)
}
