import { createLibraryStore } from '../library/library_store.js'

/** 调用方先完成宿主鉴权；片库不要求选中项目或会话。 */
export function createLibraryHttpHandler(tool, json) {
  const store = createLibraryStore(tool.root)
  return async (req, res, url) => {
    if (url.pathname === '/api/drama/library' && req.method === 'GET')
      return json(res, 200, { projects: await tool.listProjects(), assets: await store.list() })
    const scriptId = url.pathname.startsWith('/api/drama/library/scripts/') ? decodeURIComponent(url.pathname.slice('/api/drama/library/scripts/'.length)) : ''
    if (scriptId && req.method === 'GET')
      return json(res, 200, { body: await store.readScript(scriptId) })
    if (scriptId && req.method === 'DELETE') {
      if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
      return json(res, 200, { deleted: true, ...(await store.remove(scriptId)) })
    }
    if (url.pathname === '/api/drama/library/scripts' && req.method === 'POST') {
      if (req.headers['x-drama-request'] !== '1') return json(res, 403, { message: '缺少面板请求标识' })
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 7 * 1024 * 1024) return json(res, 413, { message: '剧本资料过大' })
        chunks.push(chunk)
      }
      const asset = await store.importScript(JSON.parse(Buffer.concat(chunks).toString()))
      return json(res, 201, { asset })
    }
    return json(res, 405, { message: '不支持的片库请求' })
  }
}
