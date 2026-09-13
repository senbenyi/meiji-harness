// 职责：将项目存储操作适配为经过认证的 HTTP 路由。
import { withConfig } from '../config.js'
import { createProjectStore } from '../projects/store.js'
import { validProjectId } from '../projects/schema.js'
import { authenticated, invalidRequest, json, readJsonBody } from './shared.js'

export const PROJECT_ROUTE = '/plugins/dsh-elysium/project'
const actions = ['list', 'get', 'create', 'update', 'delete', 'import']

export function createProjectHandler(options) {
  const { token } = options
  const store = createProjectStore(options)
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(PROJECT_ROUTE.length + 1)
      if (!actions.includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (['list', 'get'].includes(action) ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      if (action === 'list') return json(res, 200, await store.list())
      if (action === 'get') {
        const id = url.searchParams.get('id')
        if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
        return json(res, 200, await store.read(id))
      }
      const body = await readJsonBody(req)
      return json(res, action === 'create' ? 201 : 200, await store.change(action, body))
    } catch (error) {
      const missing = ['ENOENT', 'MODEL_JOB_NOT_FOUND'].includes(error.code)
      json(res, error.status || (missing ? 404 : 503), { error: error.status ? error.message : missing ? '项目或素材不存在' : '暂时无法读取或保存项目' })
    }
  }
}

export function registerProjectRoutes(ctx, runtime, token) {
  const server = ctx.get?.('webServer')
  if (!server) return
  const handle = createProjectHandler({ token })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of actions) ctx.effect(() => server.register({ kind: 'exact', path: `${PROJECT_ROUTE}/${suffix}`, handler }), `elysium project ${suffix}`)
}
