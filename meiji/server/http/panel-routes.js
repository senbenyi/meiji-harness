import { syncChatModel } from '../host/harness-chat-model.js'
import { scriptStore, readScriptProposalArtifact } from '../data/script-store.js'
import { validateOperation } from '../flow/operations/operation-registry.js'
import { subscribeProject } from '../data/project-events.js'
import { targetNode } from '../models/data/drama-model.js'
import { shotReferenceImages } from '../../shared/reference-images.js'
import { MAX_GUIDANCE_BYTES } from '../data/asset-library-store.js'
import { MAX_SCRIPT_BYTES, scriptText } from '../../shared/script-content.js'
import { createProject } from '../flow/project-creation.js'
import { readImageDraft, readReferenceImage } from '../data/image-storage.js'
import { outputLanguage } from '../../shared/output-language.js'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalog, compactModels, normalizeModels, purposes } from '../../models/model-config.js'
import { modelStore } from '../data/model-settings.js'
import { projectStore } from '../data/project-store.js'
import { readStill } from '../media/image-files.js'
import { saveIncoming } from '../flow/steps/shared/incoming.js'
import { insertSessionLog, runWithSessionLog } from '../host/session-log.js'
import { linkStore } from '../data/workspace-links.js'
import { materialize } from '../../shared/episode-rules.js'
import { readEpisodeCover } from '../data/episode-data.js'
import { assetRoutes } from './asset-library-routes.js'
import { skillRoutes } from './skill-routes.js'
import { runRoutes } from './run-routes.js'
import { runStore } from '../data/run-store.js'

// 浏览器可加载的平铺目录：client/ 为面板界面，shared/ 为领域规则，models 的 data/tasks 为纯数据与任务 model。
const staticRoots = {
  client: fileURLToPath(new URL('../../client/', import.meta.url)),
  shared: fileURLToPath(new URL('../../shared/', import.meta.url)),
  'models-data': fileURLToPath(new URL('../models/data/', import.meta.url)),
  'models-tasks': fileURLToPath(new URL('../models/tasks/', import.meta.url)),
}
const clientMime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

export function resolveClientFile(file, dir = 'client') {
  const clientRoot = staticRoots[dir]
  if (!clientRoot) return
  if (typeof file !== 'string' || file.includes('\0')) return
  let decoded
  try { decoded = decodeURIComponent(file) } catch { return }
  if (decoded.includes('/') || decoded.includes('\\') || decoded === '.' || decoded === '..') return
  const type = clientMime[extname(decoded)]
  if (!type) return
  const resolved = resolve(clientRoot, decoded)
  const rel = relative(clientRoot, resolved)
  if (!rel || rel.startsWith('..') || rel.includes(sep)) return
  return { path: resolved, type }
}

async function readBytes(req, limit, message = '图片过大') {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error(message), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req, limit) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw Object.assign(new Error('请求过大'), { status: 413 })
  }
  if (!body.trim()) return {}
  try { return JSON.parse(body) }
  catch { throw Object.assign(new Error('请求内容格式错误'), { status: 400 }) }
}

function sendVideo(req, res, filePath, size) {
  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
  }
  const range = req.headers.range
  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': size })
    createReadStream(filePath).pipe(res)
    return
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  const start = match?.[1] ? Number(match[1]) : 0
  let end = match?.[2] ? Number(match[2]) : size - 1
  if (!match || !Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }
  end = Math.min(end, size - 1)
  res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` })
  createReadStream(filePath, { start, end }).pipe(res)
}

export function registerPanel(ctx, ready = Promise.resolve(), edits, runs, runJobs) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const store = modelStore(home)
  const projects = projectStore(home)
  const links = linkStore(home, ctx.workspaceController)
  const enterProject = async (projectId, currentSessionId) => {
    const place = await links.ensureProject(projectId, projects)
    const sessionId = currentSessionId || (await ctx.sessionController.create({ workspaceId: place.workspace.workspaceId })).sessionId
    await links.selectProject(sessionId, projectId, projects)
    return { workspace: { id: place.workspace.workspaceId, title: place.workspace.title }, projectId, title: place.title, sessionId }
  }
  const base = '/plugins/meiji'
  let saving = false
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const handleAssets = assetRoutes(home, json)
  const handleSkills = skillRoutes({ home, projects, links, json, readJson })
  const handleRuns = runRoutes({ service: runs, jobs: runJobs, json, readJson, base })
  const serveClient = async (res, file, dir = 'client') => {
    const resolved = resolveClientFile(file, dir)
    if (!resolved) {
      res.writeHead(404, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end()
    }
    try {
      const content = await readFile(resolved.path)
      res.writeHead(200, { 'Content-Type': resolved.type, 'Cache-Control': 'no-store' })
      res.end(content)
    } catch {
      res.writeHead(404, { 'Content-Type': resolved.type, 'Cache-Control': 'no-store' })
      res.end()
    }
  }
  const fail = (error, fallback) => {
    ctx.logger.warn('Meiji request failed: %s', error.message)
    const message = error.status ? error.message : (error.message && error.message !== fallback ? error.message : fallback)
    return { status: error.status || 400, error: message }
  }
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname
    try {
      try { await ready } catch { throw Object.assign(new Error('制作任务服务恢复失败，请检查服务日志'), { status: 503 }) }
      if (path === base + '/panel.js' || path.startsWith(base + '/client/') || path.startsWith(base + '/shared/') || path.startsWith(base + '/server/models/')) {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/javascript; charset=utf-8' })
          return res.end()
        }
        if (path === base + '/panel.js') return serveClient(res, 'panel.js')
        const model = path.startsWith(base + '/server/models/') ? path.slice((base + '/server/models/').length).split('/') : null
        const dir = model ? { data: 'models-data', tasks: 'models-tasks' }[model[0]] : path.startsWith(base + '/shared/') ? 'shared' : 'client'
        const file = model ? model.slice(1).join('/') : path.slice((base + '/' + dir + '/').length)
        if (!dir) { res.writeHead(404); return res.end() }
        return serveClient(res, file, dir)
      }
      const rejection = ctx.connection.requestRejection(req)
      if (rejection) return json(res, rejection, { error: '请刷新并登录 Harness' })
      if (await handleRuns(req, res, url)) return
      if (path === base + '/script' && req.method === 'GET') {
        const projectId = url.searchParams.get('projectId')
        await links.requireProject(url.searchParams.get('sessionId'), projectId)
        const project = await projects.read(projectId)
        const proposals = await Promise.all((project.scriptProposals || []).map(async entry => ({ ...(await readScriptProposalArtifact(home, projectId, entry.id)).content, ...(entry.runId ? { runId: entry.runId, stepId: entry.stepId } : {}), status: entry.status })))
        return json(res, 200, { project, versions: await scriptStore(home, projects).versions(projectId), proposals })
      }
      if (path === base + '/assets' || path === base + '/asset-file') return handleAssets(req, res, url)
      if (path === base + '/link') {
        if (req.method === 'GET') {
          const place = await links.projectForSession(url.searchParams.get('sessionId'))
          return json(res, 200, { workspace: place.workspace, projectId: place.projectId })
        }
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        try {
          const body = await readJson(req, 8192)
          const place = await enterProject(body.projectId, body.sessionId)
          return json(res, 200, place)
        } catch (error) {
          const result = fail(error, '绑定失败')
          return json(res, result.status, { error: result.error })
        }
      }
      if (path === base + '/incoming') {
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        try {
          const name = decodeURIComponent(String(req.headers['x-meiji-name'] || ''))
          const category = String(req.headers['x-meiji-category'] || '')
          const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
          const limit = category === 'scripts' ? MAX_SCRIPT_BYTES : category === 'guidance' ? MAX_GUIDANCE_BYTES : category ? 512 * 1024 * 1024 : 12 * 1024 * 1024
          const bytes = await readBytes(req, limit, category === 'scripts' ? '剧本不能超过 1 MB' : '图片过大')
          if (category === 'scripts') {
            if (!/\.(txt|text)$/i.test(name)) throw Object.assign(new Error('剧本仅支持 TXT/TEXT 文件'), { status: 400 })
            scriptText(bytes)
          }
          const incomingId = await saveIncoming(home, { name, category, mime, bytes })
          return json(res, 201, { incomingId })
        } catch (error) {
          const result = fail(error, '上传失败')
          return json(res, result.status, { error: result.error })
        }
      }
      if (path === base + '/reference-preview') {
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        const project = materialize(await projects.read(url.searchParams.get('projectId')), url.searchParams.get('episodeId'))
        const story = project.shots.items.find(s => s.id === url.searchParams.get('track'))?.storyboard.content
        if (!story) return json(res, 404, { error: '文本分镜不存在' })
        const reference = shotReferenceImages(project, story)[Number(url.searchParams.get('index'))]
        if (!reference) return json(res, 404, { error: '引用不存在' })
        const image = await readReferenceImage(home, project, reference)
        res.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
        return res.end(image.bytes)
      }
      if (path === base + '/image-draft') {
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        const draft = await readImageDraft(home, url.searchParams.get('id'))
        res.writeHead(200, { 'Content-Type': draft.metadata.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
        return res.end(draft.bytes)
      }
      if (path === base + '/image-review') {
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        const body = await readJson(req, 8192)
        if (!['confirm-image', 'discard-image'].includes(body.action)) return json(res, 400, { error: '图片操作无效' })
        await links.requireProject(String(body.sessionId || ''), body.projectId)
        const started = edits.start({ action: body.action, projectId: body.projectId, episodeId: body.episodeId, draftId: body.draftId, sessionId: body.sessionId }, null, { imageReviewAllowed: true })
        const trace = await started.done
        if (started.failure) throw started.failure
        insertSessionLog(ctx.sessions.get(body.sessionId), trace.trace.join('\n'))
        return json(res, 200, { project: await projects.read(body.projectId) })
      }
      if (path === base + '/review-draft') {
        if (req.method !== 'PUT') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        const body = await readJson(req, 450000)
        await links.requireProject(String(body.sessionId || ''), body.projectId)
        const saved = await projects.saveReviewDraft(body.projectId, body.episodeId, body.key, body.text, body.revision, body.kind)
        const episode = saved.episodes.find(e => e.id === body.episodeId)
        return json(res, 200, { project: saved, review: targetNode(episode, body.key)[body.kind === 'text' ? 'draft' : 'review'] })
      }
      if (path === base + '/skills' || path.startsWith(base + '/skills/') || path === base + '/node-skills' || path === base + '/project-skills' || path === base + '/project-guidance') {
        const handled = await handleSkills(req, res, url, base)
        return handled === false ? json(res, 404, { error: '技能不存在' }) : handled
      }
      if (path === base + '/project-settings') {
        if (req.method !== 'PUT') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        const body = await readJson(req, 8192)
        await links.requireProject(String(body.sessionId || ''), body.projectId)
        const project = await projects.save(body.projectId, { outputLanguage: outputLanguage(body.outputLanguage) })
        return json(res, 200, { project })
      }
      if (path === base + '/events') {
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        const projectId = url.searchParams.get('projectId')
        await links.requireProject(url.searchParams.get('sessionId'), projectId)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
        const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`)
        const unsubscribe = subscribeProject(home, projectId, send)
        send({ projectId })
        const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000)
        res.on('close', () => { clearInterval(heartbeat); unsubscribe() })
        return
      }
      const artifactRoute = path.match(new RegExp('^' + base + '/artifacts/([A-Za-z0-9_-]+)$'))
      if (artifactRoute && req.method === 'GET') {
        const projectId = url.searchParams.get('projectId')
        await links.requireProject(url.searchParams.get('sessionId'), projectId)
        return json(res, 200, { artifact: await runStore(home, projectId).readRecord('artifacts', artifactRoute[1]) })
      }
      if (path === base + '/turn') {
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        try {
          const body = await readJson(req, 2000000)
          if (body.action === 'create') {
            const place = await createProject({ home, edits, fields: body.fields, enter: project => enterProject(project.id) })
            insertSessionLog(ctx.sessions.get(place.sessionId), '已创建短剧')
            return json(res, 201, { ...place, accepted: true })
          }
          const sessionId = String(body.sessionId || '')
          if (!/^session-[0-9a-f-]{36}$/i.test(sessionId)) return json(res, 409, { error: '没有打开的会话，无法关联任务日志' })
          const deleting = body.action === 'project-delete'
          const selected = deleting ? await links.projectForSession(sessionId) : null
          if (body.projectId && !deleting) await links.requireProject(sessionId, body.projectId)
          const project = body.projectId ? await projects.read(body.projectId) : null
          const staged = { ...body, projectId: project?.id, origin: 'panel' }
          if (['project-delete', 'episode-delete'].includes(staged.action)) {
            const activeRuns = (await runs.list(project.id, sessionId)).filter(run => ['draft', 'running', 'paused'].includes(run.status) && (staged.action === 'project-delete' || !run.episodeId || run.episodeId === staged.episodeId))
            await Promise.all(activeRuns.map(run => runs.cancel(project.id, run.id, sessionId)))
            await edits.cancel(project.id, staged.action === 'project-delete' ? null : staged.episodeId)
          }
          validateOperation(staged)
          const started = edits.start(staged, ctx.sessions.get(sessionId))
          const outcome = await started.done
          if (started.failure) throw started.failure
          const next = deleting ? { deleted: true, ...(selected.projectId === project.id ? { workspace: null, sessionId: (await ctx.sessionController.create({})).sessionId } : {}) } : project ? { project: await projects.read(project.id) } : {}
          return json(res, 200, { accepted: true, completed: true, editId: started.id, result: outcome.result, ...(outcome.continueRun ? { continueRun: outcome.continueRun } : {}), ...next })
        } catch (error) {
          const result = fail(error, '启动任务失败')
          // 本集被占用（面板或会话的操作排队中或执行中）：附带占用者，面板据此提示。
          return json(res, result.status, { error: result.error, ...(error.code ? { code: error.code } : {}), ...(error.busy ? { busy: error.busy } : {}) })
        }
      }
      const episodeFilm = path.match(new RegExp('^' + base + '/projects/([^/]+)/films/([^/]+)/([^/]+)$'))
      if (episodeFilm) {
        const id = decodeURIComponent(episodeFilm[1])
        const episodeId = decodeURIComponent(episodeFilm[2])
        const track = decodeURIComponent(episodeFilm[3])
        if (!/^[0-9a-f-]{36}$/i.test(episodeId) || !/^(S[0-9]{2}|assembly)$/.test(track)) return json(res, 400, { error: '成片不存在' })
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try {
          const project = await projects.read(id)
          const episode = project.episodes.find(e => e.id === episodeId)
          const file = (track === 'assembly' ? episode?.assembly.content?.file : episode?.shots.items.find(s => s.id === track)?.video.content?.file) || `${track}.mp4`
          const filePath = join(home, 'storages', 'meiji', 'projects', id, 'films', episodeId, file)
          const info = await stat(filePath)
          return sendVideo(req, res, filePath, info.size)
        } catch (error) {
          return json(res, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? '成片不存在' : error.status ? error.message : '读取成片失败' })
        }
      }
      const film = path.match(new RegExp('^' + base + '/projects/([^/]+)/films/([^/]+)$'))
      if (film) {
        const id = decodeURIComponent(film[1])
        const track = decodeURIComponent(film[2])
        if (!/^(S[0-9]{2}|assembly)$/.test(track)) return json(res, 400, { error: '成片不存在' })
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try {
          await projects.read(id)
          const filePath = join(home, 'storages', 'meiji', 'projects', id, 'films', `${track}.mp4`)
          const info = await stat(filePath)
          return sendVideo(req, res, filePath, info.size)
        } catch (error) {
          return json(res, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? '成片不存在' : error.status ? error.message : '读取成片失败' })
        }
      }
      const cover = path.match(new RegExp('^' + base + '/projects/([^/]+)/covers/([^/]+)$'))
      if (cover) {
        const id = decodeURIComponent(cover[1])
        const episodeId = decodeURIComponent(cover[2])
        if (!/^[0-9a-f-]{36}$/i.test(episodeId)) return json(res, 400, { error: '封面不存在' })
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try {
          await projects.read(id)
          const file = await readEpisodeCover(home, id, episodeId)
          res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' })
          return res.end(file.bytes)
        } catch (error) {
          return json(res, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? '封面不存在' : error.status ? error.message : '读取封面失败' })
        }
      }
      const tailRoute = path.match(new RegExp('^' + base + '/projects/([^/]+)/tail-frame/([^/]+)/(S[0-9]+)$'))
      if (tailRoute) {
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try {
          const project = await projects.read(tailRoute[1])
          const frame = project.episodes.find(e => e.id === tailRoute[2])?.shots.items.find(s => s.id === tailRoute[3])?.tailFrame?.content
          if (!frame?.localPath) return json(res, 404, { error: '尾帧尚未生成' })
          const bytes = await readFile(frame.localPath)
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-cache' })
          return res.end(bytes)
        } catch { return json(res, 404, { error: '尾帧不可用' }) }
      }
      const still = path.match(new RegExp('^' + base + '/projects/([^/]+)/images/([^/]+)$'))
      if (still) {
        const id = decodeURIComponent(still[1])
        const item = decodeURIComponent(still[2])
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(item)) return json(res, 400, { error: '图片不存在' })
        const episodeId = url.searchParams.get('episodeId') || ''
        if (episodeId && !/^[0-9a-f-]{36}$/i.test(episodeId)) return json(res, 400, { error: '剧集 ID 无效' })
        const directory = join(home, 'storages', 'meiji', 'projects', id, 'images', episodeId)
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try {
          await projects.read(id)
          const file = await readStill(directory, item)
          res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' })
          return res.end(file.bytes)
        } catch (error) {
          return json(res, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? '图片不存在' : error.status ? error.message : '读取图片失败' })
        }
      }
      if (path.startsWith(base + '/projects/')) {
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try { return json(res, 200, { project: await projects.read(decodeURIComponent(path.slice((base + '/projects/').length))) }) }
        catch (error) { return json(res, error.status || 400, { error: error.status ? error.message : '读取项目失败' }) }
      }
      if (path === base + '/projects') {
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        return json(res, 200, { projects: await projects.list() })
      }
      if (req.method === 'GET' && path === base + '/models') {
        const stored = await store.read()
        const routes = { ...stored }
        delete routes.apiKey
        return json(res, 200, { routes, choices: catalog(ctx.settings), purposes })
      }
      if (req.method !== 'PUT' || path !== base + '/models') return json(res, 405, { error: '不支持的请求' })
      if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
      if (saving) return json(res, 409, { error: '正在保存，请稍后重试' })
      saving = true
      try {
        const routes = compactModels(normalizeModels(await readJson(req, 8192)))
        await syncChatModel(ctx, routes)
        await store.write(routes)
        return json(res, 200, { saved: true })
      } finally { saving = false }
    } catch (error) {
      ctx.logger.warn('Meiji configuration request failed: %s', error.message)
      return json(res, error.status || 400, { error: error.status ? error.message : '操作失败，请检查输入或服务日志', ...(error.code ? { code: error.code } : {}), ...(error.busy ? { busy: error.busy } : {}) })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, handler }), 'meiji: panel routes')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'script-src', placement: 'body', src: base + '/panel.js' }))
}
