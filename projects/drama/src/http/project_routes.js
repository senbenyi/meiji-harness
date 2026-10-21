import { createRecordService } from '../records/service.js'
import { serveRecordRoute } from './record_routes.js'
import { readFile } from 'node:fs/promises'
import { createLibraryHttpHandler } from './library_routes.js'
import { createModelSettings, modelOptions } from '../settings/model-settings.js'

const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function createProjectHttpHandler(tool, { authorize, models = createModelSettings(tool.root) }) {
  const streams = new Set()
  const records = tool.records || createRecordService(tool.root)
  tool.records = records
  const library = createLibraryHttpHandler(tool, json)
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      const rejected = authorize(req)
      if (rejected) return json(res, rejected, { message: '请登录 Harness' })
      if (url.pathname.startsWith('/plugins/drama/packages/') || ['/api/drama/http-records', '/api/drama/task-history'].includes(url.pathname))
        return await serveRecordRoute(req, res, url, records, json)
      if (url.pathname.startsWith('/plugins/drama/src/client/')) {
        const name = url.pathname.slice('/plugins/drama/src/client/'.length)
        if (req.method !== 'GET') return json(res, 405, { message: '不支持的请求' })
        if (!/^[a-z-]+\.(js|css)$/.test(name)) return json(res, 404, { message: '文件不存在' })
        let bytes = await readFile(new URL(`../client/${name}`, import.meta.url))
        if (name === 'workbench.js') bytes = Buffer.from(bytes.toString().replaceAll("'@agent-modules/task/ui'", "'/plugins/drama/packages/task/index.js'").replaceAll("'@agent-modules/http-client/ui'", "'/plugins/drama/packages/http-client/index.js'"))
        res.writeHead(200, { 'Content-Type': name.endsWith('.css') ? 'text/css' : 'text/javascript', 'Cache-Control': 'no-store' })
        return res.end(bytes)
      }
      if (url.pathname === '/api/drama/library' || url.pathname.startsWith('/api/drama/library/'))
        return await library(req, res, url)
      if (url.pathname === '/api/drama/settings') {
        if (req.method === 'GET') return json(res, 200, { settings: await models.read(), modelOptions })
        if (req.method !== 'POST') return json(res, 405, { message: '不支持的请求' })
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 65536) return json(res, 413, { message: '设置内容过大' })
          chunks.push(chunk)
        }
        const { settings } = JSON.parse(Buffer.concat(chunks).toString())
        const saved = await models.save(settings)
        const sessionId = url.searchParams.get('session_id')
        if (settings.session && tool.applyMainAgent && /^session-[a-f0-9-]{36}$/i.test(sessionId || '')) await tool.applyMainAgent(sessionId)
        return json(res, 200, { settings: saved })
      }
      if (url.pathname === '/api/drama/sessions') {
        if (req.method !== 'POST') return json(res, 405, { message: '不支持的请求' })
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 4096) return json(res, 413, { message: '会话请求过大' })
          chunks.push(chunk)
        }
        const { request_id } = JSON.parse(Buffer.concat(chunks).toString())
        return json(res, 200, await tool.startSession(request_id))
      }
      const sessionId = url.searchParams.get('session_id')
      if (!sessionId) return json(res, 400, { message: '需提供会话ID' })
      if (url.pathname === '/api/drama/project' && req.method === 'GET') {
        if (tool.applyMainAgent && /^session-[a-f0-9-]{36}$/i.test(sessionId)) await tool.applyMainAgent(sessionId)
        return json(res, 200, await tool.snapshot(sessionId))
      }
      if (url.pathname === '/api/drama/projects' && req.method === 'POST') {
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 2 * 1024 * 1024) return json(res, 413, { message: '项目资料过大' })
          chunks.push(chunk)
        }
        const { fields, request_id } = JSON.parse(Buffer.concat(chunks).toString())
        return json(res, 200, await tool.create(fields.basic_info, { sessionId, requestId: request_id }))
      }
      if (url.pathname === '/api/drama/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`)
        const created = event => {
          if (event.source_session_id === sessionId || event.session_id === sessionId) send({ type: 'created', ...event })
        }
        tool.on('created', created)
        send({ type: 'refresh' })
        const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000)
        const close = () => { clearInterval(timer); tool.off('created', created); streams.delete(res); res.end() }
        res.once('close', close)
        streams.add(res)
        return
      }
      return json(res, 404, { message: '端点不存在' })
    } catch (error) {
      return json(res, error.code === 'ENOENT' ? 404 : 422, { message: error.message })
    }
  }
  let closing
  handler.dispose = () => { for (const stream of streams) stream.end(); return closing ||= records.dispose() }
  return handler
}
