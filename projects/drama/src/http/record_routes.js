import { readFile } from 'node:fs/promises'
const assets = {
  'task/index.js': new URL('../../../../packages/task/ui/index.js', import.meta.url),
  'task/styles.js': new URL('../../../../packages/task/ui/styles.js', import.meta.url),
  'http-client/index.js': new URL('../../../../packages/http-client/ui/index.js', import.meta.url),
  'http-client/styles.js': new URL('../../../../packages/http-client/ui/styles.js', import.meta.url),
}

/** 调用方先完成认证；只提供GET读取，不允许浏览器提交执行记录。 */
export async function serveRecordRoute(req, res, url, records, json) {
  if (req.method !== 'GET') return json(res, 405, { message: '不支持的请求' })
  if (url.pathname.startsWith('/plugins/drama/packages/')) {
    const asset = assets[url.pathname.slice('/plugins/drama/packages/'.length)]
    if (!asset) return json(res, 404, { message: '文件不存在' })
    const text = (await readFile(asset, 'utf8')).replaceAll("'@agent-modules/http-client/ui'", "'/plugins/drama/packages/http-client/index.js'")
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(text)
  }
  const id = url.searchParams.get('id')
  if (url.pathname === '/api/drama/http-records') {
    if (id) { const record = records.http.read(id); return json(res, record ? 200 : 404, record ? { record } : { message: 'HTTP记录不存在' }) }
    return json(res, 200, { records: records.http.list({ offset: Number(url.searchParams.get('offset') || 0), limit: Number(url.searchParams.get('limit') || 20) }) })
  }
  if (url.pathname === '/api/drama/task-history') {
    if (id) { const detail = records.tasks.detail(records.scope, id); return json(res, detail ? 200 : 404, detail ? { detail } : { message: '任务组不存在' }) }
    return json(res, 200, { ...records.tasks.history(records.scope, {
      offset: Number(url.searchParams.get('offset') || 0), limit: Number(url.searchParams.get('limit') || 20),
      status: url.searchParams.get('status') || '', node_type: url.searchParams.get('node_type') || '',
    }), nodeTypes: records.nodeTypes })
  }
  return json(res, 404, { message: '端点不存在' })
}
