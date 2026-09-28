import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { assetStore, MAX_ASSET_BYTES } from '../data/library.js'

export function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? { start, end, partial: true } : null
}

export function assetRoutes(home, json) {
  const store = assetStore(home)
  return async (req, res, url) => {
    try {
      const category = url.searchParams.get('category')
      if (url.pathname === '/plugins/meiji/assets') {
        if (req.method === 'GET') return json(res, 200, { assets: await store.list(category) })
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
        if (req.headers['x-meiji-request'] !== '1') return json(res, 403, { error: '需要同源请求' })
        if (Number(req.headers['content-length']) > MAX_ASSET_BYTES) return json(res, 413, { error: '单个素材不能超过 512 MB' })
        return json(res, 201, { asset: await store.import(category, url.searchParams.get('name'), req, MAX_ASSET_BYTES, { guidanceType: url.searchParams.get('guidanceType') }) })
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支持的请求' })
      const { path, metadata } = await store.file(category, url.searchParams.get('id'))
      const range = byteRange(req.headers.range, metadata.size)
      if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${metadata.size}` }); return res.end() }
      const headers = { 'Content-Type': metadata.mime, 'Content-Length': range.end - range.start + 1, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-cache' }
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${metadata.size}`
      if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(metadata.originalName)}`
      res.writeHead(range.partial ? 206 : 200, headers)
      if (req.method === 'HEAD') return res.end()
      await pipeline(createReadStream(path, { start: range.start, end: range.end }), res)
    } catch (error) {
      if (res.headersSent) { res.destroy(); return }
      json(res, error.code === 'ENOENT' ? 404 : error.status || 500, { error: error.status ? error.message : error.code === 'ENOENT' ? '素材不存在' : '素材操作失败' })
    }
  }
}
