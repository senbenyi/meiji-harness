// 职责：将全局导演库适配为经过认证的 HTTP 路由。
import { withConfig } from '../config.js'
import { createDirectorStore } from '../business/directors/store.js'
import { createProjectStore } from '../business/projects/store.js'
import { authenticated, json, readJsonBody } from './shared.js'

export const DIRECTOR_ROUTE = '/plugins/dsh-elysium/director'
const actions = ['list', 'create', 'reorder', 'delete']

export function createDirectorHandler(options) {
  const { token } = options
  const directors = options.directorStore || createDirectorStore()
  const projects = options.projectStore || createProjectStore({ directorExists: name => directors.has(name) })
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(DIRECTOR_ROUTE.length + 1)
      if (!actions.includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (action === 'list' ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      if (action === 'list') return json(res, 200, await directors.list())
      const body = await readJsonBody(req)
      if (action === 'create') return json(res, 201, await directors.create(body))
      if (action === 'reorder') return json(res, 200, await directors.reorder(body.names))
      return json(res, 200, await directors.remove(body.name, name => projects.usesDirector(name)))
    } catch (error) {
      json(res, error.status || 503, { error: error.status ? error.message : '暂时无法读取或保存导演库' })
    }
  }
}

export function registerDirectorRoutes(ctx, runtime, token, directorStore, projectStore) {
  const server = ctx.get?.('webServer')
  if (!server) return
  const handle = createDirectorHandler({ token, directorStore, projectStore })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of actions) ctx.effect(() => server.register({ kind: 'exact', path: `${DIRECTOR_ROUTE}/${suffix}`, handler }), `elysium director ${suffix}`)
}
