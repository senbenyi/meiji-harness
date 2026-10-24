import { clientAssets } from './client_assets.js'
import { createRecordService } from '../records/service.js'
import { serveRecordRoute } from './record_routes.js'
import { readFile } from 'node:fs/promises'
import { createLibraryHttpHandler } from './library_routes.js'
import { createModelSettings, modelOptions } from '../settings/model-settings.js'
import { renderNodeRules, nodeContract } from '../node_runtime/output_contract_renderer.js'
import { nodeState } from '../node_runtime/node_state.js'

const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function createProjectHttpHandler(tool, { authorize, models = createModelSettings(tool.root), scriptRevision, storySegments, sceneExtraction, groupSetting, characterExtraction, costumeImages, sceneImages, shotDesign }) {
  const streams = new Set(), creations = new Map()
  let cursor = 0
  // 暂停实时连接时仍保留每个来源会话的最新创建通知，恢复后补发。
  const rememberCreation = event => creations.set(event.source_session_id, { ...event, cursor: ++cursor })
  tool.on?.('created', rememberCreation)
  const forgetCreation = event => {
    if (event.deleted) for (const [source, creation] of creations) if (creation.project_id === event.project_id) creations.delete(source)
  }
  tool.on?.('updated', forgetCreation)
  const records = tool.records || createRecordService(tool.root)
  tool.records = records
  tool.enableTaskRecords?.(records)
  const library = createLibraryHttpHandler(tool, json)
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      const rejected = authorize(req)
      if (rejected) return json(res, rejected, { message: '请登录 Harness' })
      if (url.pathname.startsWith('/plugins/drama/packages/') || ['/api/drama/http-records', '/api/drama/task-history'].includes(url.pathname))
        return await serveRecordRoute(req, res, url, records, json)
      if (url.pathname.startsWith('/plugins/drama/src/')) {
        const name = url.pathname.slice('/plugins/drama/src/'.length)
        if (req.method !== 'GET') return json(res, 405, { message: '不支持的请求' })
        const asset = clientAssets.get(name)
        if (!asset) return json(res, 404, { message: '文件不存在' })
        let bytes = await readFile(asset)
        if (name.endsWith('.js')) bytes = Buffer.from(bytes.toString().replaceAll("'@agent-modules/ui'", "'/plugins/drama/packages/ui/index.js'").replaceAll("'@agent-modules/task/ui'", "'/plugins/drama/packages/task/index.js'").replaceAll("'@agent-modules/http-client/ui'", "'/plugins/drama/packages/http-client/index.js'").replaceAll("'@agent-modules/prompt-composer/ui'", "'/plugins/drama/packages/prompt-composer/ui/rules-panel.js'"))
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
      if (url.pathname === '/api/drama/scene-image' && req.method === 'GET') {
        const bytes = await sceneImages.readImage(sessionId, url.searchParams.get('file'))
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }); return res.end(bytes)
      }
      if (['/api/drama/scene-images', '/api/drama/scene-image-inputs'].includes(url.pathname) && req.method === 'POST') {
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 24 * 1024 * 1024) return json(res, 413, { message: '场景图输入过大' }); chunks.push(chunk) }
        const {project_id,request_id,retry_action,...input} = JSON.parse(Buffer.concat(chunks).toString())
        const context = {sessionId,projectId:project_id,requestId:request_id,source:'ui',retryAction:retry_action}
        return json(res, url.pathname.endsWith('-inputs') ? 200 : 202, url.pathname.endsWith('-inputs') ? await sceneImages.saveInputs(input,context) : await sceneImages.generate(input,context))
      }
      if (url.pathname === '/api/drama/costume-image' && req.method === 'GET') {
        const bytes = await costumeImages.readImage(sessionId, url.searchParams.get('file'))
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }); return res.end(bytes)
      }
      if (url.pathname === '/api/drama/node-rules' && req.method === 'GET') {
        const type = url.searchParams.get('node_type')
        nodeContract(type)
        const { project } = await tool.snapshot(sessionId)
        if (!project) return json(res, 403, { message: '当前会话未绑定项目' })
        const state = nodeState(project, type)
        if (state?.type !== 1 || !state.rules) return json(res, 422, { message: '该节点没有AI规则' })
        return json(res, 200, { bases: Object.fromEntries(['generate', 'revise', 'review'].map(action => [action, renderNodeRules(state, action).base])) })
      }
      if (url.pathname === '/api/drama/task-messages' && req.method === 'GET') {
        const rawAfter = url.searchParams.get('after') || '-1'
        if (!/^-?\d+$/.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter)) || Number(rawAfter) < -1) return json(res, 400, { message: '消息游标无效' })
        const result = await tool.readTaskMessages?.(sessionId, { id: url.searchParams.get('id') || undefined, compact: url.searchParams.get('compact') === '1',
          eager: url.searchParams.get('eager') === '1', after: Number(rawAfter), pending: (url.searchParams.get('pending') || '').split(',').filter(Boolean) }) || []
        return json(res, 200, Array.isArray(result) ? { messages: result } : result)
      }
      if (url.pathname === '/api/drama/node-states' && req.method === 'GET')
        return json(res, 200, await tool.nodeStates(sessionId))
      if (url.pathname === '/api/drama/original-script' && req.method === 'GET')
        return json(res, 200, await tool.readOriginalScript(sessionId))
      if (url.pathname === '/api/drama/project' && req.method === 'GET') {
        // 在异步快照前采样，补回首次加载期间、SSE尚未连接时的创建交接。
        res.setHeader('X-Drama-Event-Cursor', String(cursor))
        if (tool.applyMainAgent && /^session-[a-f0-9-]{36}$/i.test(sessionId)) await tool.applyMainAgent(sessionId)
        const snapshot = await tool.snapshot(sessionId)
        const active = snapshot.project && tool.activeExecution(snapshot.project.basic_info.id, 'script_revision')
        const storyActive = snapshot.project && tool.activeExecution(snapshot.project.basic_info.id, 'story_segments')
        return json(res, 200, { ...snapshot, ...(active ? { script_execution: active } : {}), ...(storyActive ? { story_execution: storyActive } : {}), ...(snapshot.project ? { shot_execution: tool.activeExecution(snapshot.project.basic_info.id, 'shot_design'), scene_execution: tool.activeExecution(snapshot.project.basic_info.id, 'scene_extraction'), group_execution: tool.activeExecution(snapshot.project.basic_info.id, 'group_setting'), character_execution: tool.activeExecution(snapshot.project.basic_info.id, 'character_extraction'), image_execution: tool.activeExecution(snapshot.project.basic_info.id, 'costume_image'), scene_image_execution: tool.activeExecution(snapshot.project.basic_info.id, 'scene_image') } : {}) })
      }
      if (url.pathname === '/api/drama/project' && req.method === 'DELETE') {
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []; let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 4096) return json(res, 413, { message: '删除请求过大' })
          chunks.push(chunk)
        }
        const { project_id } = JSON.parse(Buffer.concat(chunks).toString())
        return json(res, 200, await tool.remove({ sessionId, projectId: project_id }))
      }
      if (url.pathname === '/api/drama/script-optimization' && req.method === 'POST') {
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 65536) return json(res, 413, { message: '优化要求过大' }); chunks.push(chunk) }
        const { project_id, request_id, instruction, retry_of, retry_action } = JSON.parse(Buffer.concat(chunks).toString())
        const result = await scriptRevision.optimizeScript({ instruction, retry_of }, { sessionId, projectId: project_id, requestId: request_id, retryAction: retry_action, source: 'ui' })
        return json(res, 202, result)
      }
      if (url.pathname === '/api/drama/story-outline' && req.method === 'POST') {
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 65536) return json(res, 413, { message: '大纲要求过大' }); chunks.push(chunk) }
        const { project_id, request_id, instruction, retry_of, retry_action } = JSON.parse(Buffer.concat(chunks).toString())
        const result = await storySegments.generateStoryOutline({ instruction, retry_of }, { sessionId, projectId: project_id, requestId: request_id, retryAction: retry_action, source: 'ui' })
        return json(res, 202, result)
      }
      if (['/api/drama/shots', '/api/drama/scenes', '/api/drama/groups', '/api/drama/characters', '/api/drama/costume-images'].includes(url.pathname) && req.method === 'POST') {
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 65536) return json(res, 413, { message: '生成要求过大' }); chunks.push(chunk) }
        const { project_id, request_id, instruction, retry_of, retry_action, character_id, costume_id, regenerate } = JSON.parse(Buffer.concat(chunks).toString())
        const context = { sessionId, projectId: project_id, requestId: request_id, retryAction: retry_action, source: 'ui' }
        const result = url.pathname.endsWith('/shots') ? await shotDesign.generateShots({ instruction, retry_of, regenerate }, context)
          : url.pathname.endsWith('/scenes') ? await sceneExtraction.extractScenes({ instruction, retry_of, regenerate }, context)
          : url.pathname.endsWith('/groups') ? await groupSetting.generateGroups({ instruction, retry_of, regenerate }, context)
          : url.pathname.endsWith('/characters') ? await characterExtraction.extractCharacters({ instruction, retry_of, regenerate }, context)
          : await costumeImages.generate({ instruction, character_id, costume_id, retry_of }, context)
        return json(res, 202, result)
      }
      if (url.pathname === '/api/drama/project' && req.method === 'PATCH') {
        if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
        const chunks = []; let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 2 * 1024 * 1024) return json(res, 413, { message: '项目资料过大' })
          chunks.push(chunk)
        }
        const { project_id, command, request_id } = JSON.parse(Buffer.concat(chunks).toString())
        return json(res, 200, await tool.edit(command, { sessionId, projectId: project_id, ...(command.kind === 'import_script' ? { requestId: request_id, source: 'ui' } : {}) }))
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
        return json(res, 200, await tool.create(fields.basic_info, { sessionId, requestId: request_id, source: 'ui' }))
      }
      if (url.pathname === '/api/drama/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`)
        const created = event => {
          if (event.source_session_id === sessionId || event.session_id === sessionId) send({ type: 'created', ...event, cursor: creations.get(event.source_session_id)?.cursor })
        }
        const updated = event => { if (event.session_ids.includes(sessionId) || tool.sessionInProject?.(sessionId, event.project_id)) send({ type: 'updated', project_id: event.project_id }) }
        tool.on('created', created)
        tool.on('updated', updated)
        send({ type: 'refresh', cursor })
        const after = url.searchParams.get('cursor')
        if (after !== null && /^\d+$/.test(after)) {
          const missed = [...creations.values()].filter(event => event.cursor > Number(after) && (event.source_session_id === sessionId || event.session_id === sessionId)).sort((a, b) => a.cursor - b.cursor)
          if (missed.length) send({ type: 'created', ...missed.at(-1) })
        }
        const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000)
        const close = () => { clearInterval(timer); tool.off('created', created); tool.off('updated', updated); streams.delete(res); res.end() }
        res.once('close', close)
        streams.add(res)
        return
      }
      return json(res, 404, { message: '端点不存在' })
    } catch (error) {
      return json(res, error.code === 'PROJECT_SCOPE' ? 403 : ['EDIT_CONFLICT', 'PROJECT_ACTIVE'].includes(error.code) ? 409 : error.code === 'PROJECT_DELETED' ? 410 : error.code === 'ENOENT' ? 404 : 422, { message: error.message })
    }
  }
  let closing
  handler.dispose = () => { tool.off?.('created', rememberCreation); tool.off?.('updated', forgetCreation); creations.clear(); for (const stream of streams) stream.end(); return closing ||= records.dispose() }
  return handler
}
