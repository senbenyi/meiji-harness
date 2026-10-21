import { groupSummary } from '@agent-modules/task/models'
import { readFile } from 'node:fs/promises'
const assets = {
  'prompt-composer/ui/rules-panel.js': new URL('../../../../packages/prompt-composer/src/ui/rules-panel.js', import.meta.url),
  'prompt-composer/ui/rules-styles.js': new URL('../../../../packages/prompt-composer/src/ui/rules-styles.js', import.meta.url),
  'prompt-composer/rules-model.js': new URL('../../../../packages/prompt-composer/src/rules-model.js', import.meta.url),
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
  // 项目/节点关联属于drama；公共包只提供记录Model和UI。
  const projectId = url.searchParams.get('project_id')
  if (projectId) {
    const nodeType = url.searchParams.get('node_type')
    if (!/^p_[a-f0-9-]{36}$/i.test(projectId) || !records.nodeTypes.some(node => node.type === nodeType))
      return json(res, 422, { message: '需提供有效的项目与节点类型' })
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 20)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      return json(res, 422, { message: '分页参数无效' })
    const snapshot = records.tasks.store.read(records.scope)
    const groups = new Map(snapshot.groups.map(group => [group.id, group]))
    const tasks = snapshot.tasks.filter(task => task.node_type === nodeType && (task.metadata.project_id ?? groups.get(task.group_id)?.metadata.project_id) === projectId)
    const taskIds = new Set(tasks.map(task => task.id))
    const steps = snapshot.steps.filter(step => taskIds.has(step.task_id))
    const id = url.searchParams.get('id')
    if (url.pathname === '/api/drama/task-history') {
      const summaries = [...new Set(tasks.map(task => task.group_id))].map(groupId => groupSummary(groups.get(groupId), tasks.filter(task => task.group_id === groupId)))
        .sort((a, b) => Math.max(...b.tasks.map(task => task.queue_order)) - Math.max(...a.tasks.map(task => task.queue_order)))
      if (id) {
        const summary = summaries.find(row => row.group.id === id)
        const detail = summary && { ...summary, steps: steps.filter(step => summary.tasks.some(task => task.id === step.task_id)) }
        return json(res, detail ? 200 : 404, detail ? { detail } : { message: '节点任务组不存在' })
      }
      const status = url.searchParams.get('status'), filtered = summaries.filter(row => !status || row.status === status)
      return json(res, 200, { groups: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, nodeTypes: records.nodeTypes.filter(node => node.type === nodeType) })
    }
    if (url.pathname === '/api/drama/http-records') {
      const linked = new Map(steps.flatMap(step => step.http).map(row => [row.id, row]))
      if (id) {
        const record = linked.has(id) && (records.http.read(id) || linked.get(id))
        return json(res, record ? 200 : 404, record ? { record } : { message: '节点HTTP记录不存在' })
      }
      const rows = [...linked.values()].map(row => records.http.read(row.id) || row).reverse()
      return json(res, 200, { records: rows.slice(offset, offset + limit).map(({ id, title, method, path, started_at, returned_at, status, ok, error }) => ({ id, title, method, path, started_at, returned_at, status, ok, error })) })
    }
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
