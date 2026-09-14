// 职责：将项目存储操作适配为经过认证的 HTTP 路由。
import { withConfig } from '../config.js'
import { createProjectStore } from '../projects/store.js'
import { createDirectorStore } from '../directors/store.js'
import { validProjectId } from '../projects/schema.js'
import { authenticated, invalidRequest, json, readJsonBody } from './shared.js'

export const PROJECT_ROUTE = '/plugins/dsh-elysium/project'
const actions = ['list', 'get', 'create', 'update', 'delete', 'import', 'update-anchor', 'update-shot', 'poll']

export function createProjectHandler(options) {
  const { token } = options
  const directors = options.directorStore || createDirectorStore()
  const store = options.projectStore || createProjectStore({ ...options, directorExists: name => directors.has(name) })
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(PROJECT_ROUTE.length + 1)
      if (!actions.includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (['list', 'get', 'poll'].includes(action) ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
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
      const body = await readJsonBody(req)
      if (['update-anchor', 'update-shot'].includes(action)) {
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw invalidRequest('对象参数无效')
        const change = action === 'update-anchor' ? store.changeAnchor : store.changeShot
        return json(res, 200, await change(body.id, body.action, body.data))
      }
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
