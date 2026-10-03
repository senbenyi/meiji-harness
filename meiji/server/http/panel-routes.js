import { recordStore, readStepPrompts } from '../data/task-store.js'
import { stepPromptsFromLog } from '../host/step-prompt-log.js'
import { subscribeProject } from '../data/project-events.js'
import { targetNode } from '../../shared/drama-model.js'
import { shotReferenceImages } from '../../shared/reference-images.js'
import { MAX_GUIDANCE_BYTES } from '../data/asset-library-store.js'
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
import { cancelOperation } from '../flow/operations/operation-cancel.js'
import { saveIncoming } from '../flow/operations/project-operations.js'
import { insertSessionLog, runWithSessionLog } from '../host/session-log.js'
import { hostWorkspaces } from '../host/harness-workspaces.js'
import { linkStore } from '../data/workspace-links.js'
import { materialize } from '../../shared/episode-rules.js'
import { readEpisodeCover } from '../data/episode-data.js'
import { assetRoutes } from './asset-library-routes.js'
import { skillRoutes } from './skill-routes.js'

const directActions = new Set(['project-delete', 'episode-delete', 'open', 'overview', 'source', 'outline-text', 'storyboard-text', 'shot-assets', 'episode-add', 'episode-edit', 'library-import', 'import-image', 'part-import', 'part-text', 'set-reference', 'clear-reference', 'use-asset', 'clear-image', 'assemble', 'review-override'])

// 浏览器可加载的两个平铺目录：client/ 为面板界面，shared/ 为前后端共用的领域模块。
const staticRoots = {
  client: fileURLToPath(new URL('../../client/', import.meta.url)),
  shared: fileURLToPath(new URL('../../shared/', import.meta.url)),
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

async function readBytes(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('图片过大'), { status: 413 })
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

export function registerPanel(ctx, ready = Promise.resolve(), tasks) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const store = modelStore(home)
  const projects = projectStore(home)
  const workspaces = hostWorkspaces()
  const links = linkStore(home, ctx.workspaceController, workspaces)
  const enterProject = async projectId => {
    const place = await links.ensureProject(projectId, projects)
    const sessionId = workspaces.activeSessions(place.workspace.workspaceId)[0]
      || (await ctx.sessionController.create({ workspaceId: place.workspace.workspaceId })).sessionId
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
    await ready
    const url = new URL(req.url, 'http://localhost'), path = url.pathname
    try {
      if (path === base + '/panel.js' || path.startsWith(base + '/client/') || path.startsWith(base + '/shared/')) {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/javascript; charset=utf-8' })
          return res.end()
        }
        if (path === base + '/panel.js') return serveClient(res, 'panel.js')
        const dir = path.startsWith(base + '/shared/') ? 'shared' : 'client'
        return serveClient(res, path.slice((base + '/' + dir + '/').length), dir)
      }
      const rejection = ctx.connection.requestRejection(req)
      if (rejection) return json(res, rejection, { error: '请刷新并登录 Harness' })
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
          const place = await enterProject(body.projectId)
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
          const limit = category === 'guidance' ? MAX_GUIDANCE_BYTES : category ? 512 * 1024 * 1024 : 12 * 1024 * 1024
          const bytes = await readBytes(req, limit)
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
        const trace = await tasks.run({ action: body.action, projectId: body.projectId, episodeId: body.episodeId, draftId: body.draftId, sessionId: body.sessionId }, { imageReviewAllowed: true })
        insertSessionLog(ctx.sessions.get(body.sessionId), trace.join('\n'))
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
      // 「当前任务」页：本集进行中与排队中的任务及其步骤、排队位置。
      if (path === base + '/tasks/current') {
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        const projectId = url.searchParams.get('projectId')
        await links.requireProject(url.searchParams.get('sessionId'), projectId)
        return json(res, 200, { tasks: tasks.current(projectId, url.searchParams.get('episodeId') || null) })
      }
      if (path === base + '/tasks') {
        const body = req.method === 'POST' ? await readJson(req, 8192) : Object.fromEntries(url.searchParams)
        await links.requireProject(body.sessionId, body.projectId)
        if (req.method === 'GET') {
          if (body.operationId) {
            const task = await tasks.get(body.operationId, body.sessionId)
            if (task.projectId !== body.projectId) return json(res, 404, { error: '任务不属于本项目' })
            return json(res, 200, { task })
          }
          return json(res, 200, { tasks: tasks.list(body.projectId) })
        }
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        cancelOperation(tasks, { id: body.operationId, projectId: body.projectId, sessionId: body.sessionId, initiator: 'panel' })
        return json(res, 200, { accepted: true })
      }
      if (path === base + '/turn') {
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        try {
          const body = await readJson(req, 2000000)
          if (body.action === 'create') {
            const trace = await tasks.run({ action: 'create', fields: body.fields })
            const created = await projects.read(trace.result.projectId)
            const place = await enterProject(created.id)
            insertSessionLog(ctx.sessions.get(place.sessionId), `已创建短剧《${created.title}》`)
            return json(res, 201, { ...place, accepted: true })
          }
          const sessionId = String(body.sessionId || '')
          if (!/^session-[0-9a-f-]{36}$/i.test(sessionId)) return json(res, 409, { error: '没有打开的会话，无法关联任务日志' })
          if (body.projectId) await links.requireProject(sessionId, body.projectId)
          const project = body.projectId ? await projects.read(body.projectId) : null
          const staged = { ...body, projectId: project?.id, origin: 'panel' }
          if (['project-delete', 'episode-delete'].includes(staged.action) && tasks.list(project.id).length) {
            throw Object.assign(new Error('请先停止生成任务，再删除项目或剧集'), { status: 409 })
          }
          if (directActions.has(staged.action)) {
            const session = ctx.sessions.get(sessionId)
            await runWithSessionLog(session, async () => {
              try {
                const trace = await tasks.run(staged, { session })
                insertSessionLog(session, trace.join('\n'))
              } catch (error) {
                insertSessionLog(session, error.message || '操作失败', true)
                throw error
              }
            })
            return json(res, 200, { accepted: true, completed: true, ...(staged.action === 'project-delete' ? { deleted: true } : project ? { project: await projects.read(project.id) } : {}) })
          }

          const task = tasks.start(staged, ctx.sessions.get(sessionId))
          return json(res, 202, { accepted: true, operationId: task.id })
        } catch (error) {
          const result = fail(error, '启动任务失败')
          // 本集被占用（面板或会话的操作排队中或执行中）：附带占用者，面板据此提示。
          return json(res, result.status, { error: result.error, ...(error.busy ? { busy: error.busy } : {}) })
        }
      }
      if (path === base + '/history' && req.method === 'GET') {
        const projectId = url.searchParams.get('projectId')
        await links.requireProject(url.searchParams.get('sessionId'), projectId)
        await projects.read(projectId)
        const history = recordStore(home, projectId)
        const taskId = url.searchParams.get('taskId'), stepId = url.searchParams.get('stepId')
        if (taskId || stepId) {
          if (!taskId || !stepId) return json(res, 400, { error: '查看提示词需要任务和步骤编号' })
          const prompts = await readStepPrompts(home, projectId, taskId, stepId)
          if (prompts.length) return json(res, 200, { prompts })
          const task = await history.read('tasks', taskId), step = task.steps.find(item => item.id === stepId)
          const logged = stepPromptsFromLog(ctx.sessions?.get(task.sessionId), task, step)
          return json(res, 200, { prompts: logged, message: logged.length
            ? '来自当时的会话请求日志，可能包含脱敏标记。'
            : '该步骤没有提示词快照，也未找到能明确关联到该步骤的完整请求日志。旧服务生成的任务可能没有记录；更新后端代码后需要重启服务，新的请求才会保存提示词。' })
        }
        const artifactId = url.searchParams.get('artifactId')
        if (artifactId) return json(res, 200, { artifact: await history.read('artifacts', artifactId) })
        const episodeId = url.searchParams.get('episodeId')
        const tasks = (await history.list()).filter(task => !episodeId || task.episodeId === episodeId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        return json(res, 200, { tasks })
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
      const boardShot = path.match(new RegExp('^' + base + '/projects/([^/]+)/boards/(S[0-9]{2})$'))
      if (boardShot) {
        const id = decodeURIComponent(boardShot[1])
        const track = boardShot[2]
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try {
          await projects.read(id)
          const file = await readStill(join(home, 'storages', 'meiji', 'projects', id, 'boards'), track)
          res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' })
          return res.end(file.bytes)
        } catch (error) {
          return json(res, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? '铅笔分镜不存在' : error.status ? error.message : '读取铅笔分镜失败' })
        }
      }
      const board = path.match(new RegExp('^' + base + '/projects/([^/]+)/boards/([^/]+)/([^/]+)$'))
      if (board) {
        const id = decodeURIComponent(board[1])
        const episodeId = decodeURIComponent(board[2])
        const track = decodeURIComponent(board[3])
        if (!/^[0-9a-f-]{36}$/i.test(episodeId) || !/^S[0-9]{2}$/.test(track)) return json(res, 400, { error: '铅笔分镜不存在' })
        if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
        try {
          await projects.read(id)
          const file = await readStill(join(home, 'storages', 'meiji', 'projects', id, 'boards', episodeId), track)
          res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' })
          return res.end(file.bytes)
        } catch (error) {
          return json(res, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? '铅笔分镜不存在' : error.status ? error.message : '读取铅笔分镜失败' })
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
        await ctx.settings.update('agent-default-model', { provider: 'qwen38-local', model: routes.chat.model })
        await store.write(routes)
        return json(res, 200, { saved: true })
      } finally { saving = false }
    } catch (error) {
      ctx.logger.warn('Meiji configuration request failed: %s', error.message)
      return json(res, error.status || 400, { error: error.status ? error.message : '操作失败，请检查输入或服务日志' })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, handler }), 'meiji: panel routes')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'script-src', placement: 'body', src: base + '/panel.js' }))
}
