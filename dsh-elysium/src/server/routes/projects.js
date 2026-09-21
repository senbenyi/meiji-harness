// 职责：把项目文档、定妆和生产操作映射为认证 HTTP 路由。
import { withConfig } from '../../config.js'
import { createProjectStore } from '../projects/service.js'
import { createDirectorStore } from '../directors/service.js'
import { validProjectId } from '../projects/schema.js'
import { authenticated, invalidRequest, json, readJsonBody } from '../http.js'

export const PROJECT_ROUTE = '/plugins/dsh-elysium/project'
const reads = ['list', 'get', 'episode', 'poll', 'doc-read']
const actions = [...reads, 'create', 'update', 'delete', 'doc-save', 'doc-generate', 'anchor-generate', 'anchor-import', 'auto-fill', 'auto-produce', 'auto-pause',
  'reshoot', 'shot-preview', 'film-compose', 'produce-episode']

export function createProjectHandler(options) {
  const { token } = options
  const directors = options.directorStore || createDirectorStore()
  const store = options.projectStore || createProjectStore({ ...options, directorExists: name => directors.has(name) })
  const handlers = {
    'doc-save': body => store.planning.save(body),
    'doc-generate': body => store.planning.generate(body),
    'anchor-generate': body => store.generateAnchorImage(body),
    'anchor-import': body => store.replaceAnchorImage(body),
    'auto-fill': body => store.startFill(body),
    'auto-produce': body => store.startProduce(body),
    'auto-pause': body => store.pauseAuto(body),
    reshoot: body => store.reshootShot(body),
    'shot-preview': body => store.compileShot(body),
    'film-compose': body => store.requestEpisodeFilm(body.id, body.episode),
    'produce-episode': body => store.produceEpisode(body),
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
          if (!Number.isSafeInteger(since) || since < 0) throw invalidRequest('变更时间无效')
          return json(res, 200, { updated: await store.lastModified(id) > since })
        }
        return json(res, 200, await store.read(id))
      }
      if (action === 'episode') return json(res, 200, await store.readEpisode(url.searchParams.get('id'), Number(url.searchParams.get('number'))))
      if (action === 'doc-read') return json(res, 200, await store.planning.read({ id: url.searchParams.get('id'), step: url.searchParams.get('step'),
        episode: Number(url.searchParams.get('episode')) }))
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
